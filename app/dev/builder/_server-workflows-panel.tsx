'use client';
/**
 * Backend Workflows Panel — WeWeb-style layout.
 *
 * Layout:
 *   Left sidebar (280px): search + "+ Add ▾" | collapsible sections
 *                         API Endpoints (table folders + standalone)
 *                         Functions  |  Middlewares
 *   Center (flex-1):     WorkflowCanvas rendered inline (not full-screen overlay)
 *   Right mini-panel (220px): method + name + path + Public / Settings buttons
 *
 * Settings modal: Name, Folder, Method, Path, Description
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  backendWorkflows, backendTables,
  type BackendWorkflow, type BackendTable,
} from '@/lib/platform/api-client';
import { WorkflowCanvas } from './_workflow-canvas';

// ─── Constants ────────────────────────────────────────────────────────────────

type WfKind = 'API_ENDPOINT' | 'FUNCTION' | 'MIDDLEWARE';

const METHOD_COLORS: Record<string, string> = {
  GET: '#22c55e', POST: '#3b82f6', PUT: '#f59e0b',
  PATCH: '#8b5cf6', DELETE: '#ef4444',
};

const BTN: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '4px 10px', fontSize: 11, fontWeight: 500,
  background: 'transparent', color: '#94a3b8',
  border: '1px solid #1e293b', borderRadius: 5,
  cursor: 'pointer', whiteSpace: 'nowrap',
};

const INPUT: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
  padding: '7px 10px', fontSize: 12, color: '#e2e8f0', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};

const RICH_TOOLBAR_ICONS = ['T', 'B', 'I', 'S̶', '🔗', '≡', '1.', '""', '<>', '⎖', '▶'];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { projectId: string; }

export function ServerWorkflowsPanel({ projectId }: Props) {

  const [workflows, setWorkflows]   = useState<BackendWorkflow[]>([]);
  const [tables, setTables]         = useState<BackendTable[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError]           = useState('');

  // collapsed state per section key
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // search
  const [search, setSearch] = useState('');

  // add new workflow
  const [showAddMenu, setShowAddMenu]   = useState(false);
  const [saving, setSaving]             = useState(false);
  const [newWf, setNewWf]               = useState({
    name: '', method: 'POST', path: '/', kind: 'API_ENDPOINT' as WfKind,
  });
  const [showNewForm, setShowNewForm]   = useState(false);

  // settings modal
  const [showSettings, setShowSettings] = useState(false);
  const [settingsWf, setSettingsWf]     = useState<{
    id: string; name: string; method: string; path: string; kind: string;
  }>({ id: '', name: '', method: 'POST', path: '/', kind: 'API_ENDPOINT' });
  const [savingSettings, setSavingSettings] = useState(false);

  // publish
  const [publishing, setPublishing] = useState<string | null>(null); // wfId being published
  const [copied, setCopied] = useState(false);

  const togglePublish = async (wf: BackendWorkflow) => {
    setPublishing(wf.id);
    try {
      const isPublished = wf.status === 'PUBLISHED';
      const res = isPublished
        ? await backendWorkflows.unpublish(projectId, wf.id)
        : await backendWorkflows.publish(projectId, wf.id);
      setWorkflows((prev) => prev.map((w) => w.id === wf.id ? res.workflow : w));
    } catch (e) { setError((e as Error).message); }
    finally { setPublishing(null); }
  };

  const copyEndpointUrl = (wf: BackendWorkflow) => {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';
    const url = `${base}/v1/run/${projectId}/${wf.slug ?? wf.id}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // context menu
  const [ctxMenu, setCtxMenu]           = useState<{ wfId: string; x: number; y: number } | null>(null);

  // security popover
  const [secPopover, setSecPopover]     = useState<string | null>(null); // wfId
  const [securityState, setSecurityState] = useState<Record<string, { access: 'public' | 'authenticated'; middlewareIds: string[] }>>({});


  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wfRes, tbRes] = await Promise.all([
        backendWorkflows.list(projectId),
        backendTables.list(projectId),
      ]);
      setWorkflows(wfRes.workflows);
      setTables(tbRes.tables);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // ── Derive groups ─────────────────────────────────────────────────────────
  const apiEndpoints = workflows.filter((w) => w.kind === 'API_ENDPOINT');
  const functions    = workflows.filter((w) => w.kind === 'FUNCTION');
  const middlewares  = workflows.filter((w) => w.kind === 'MIDDLEWARE');

  type TableFolder = { tableName: string; displayName: string; items: BackendWorkflow[] };
  // Group using autoGroupTableId set by the backend at table-creation time
  const tableFolders: TableFolder[] = tables.map((t) => ({
    tableName: t.name,
    displayName: t.displayName ?? t.name,
    items: apiEndpoints.filter((w) => w.autoGroupTableId === t.id),
  }));

  const tableItemIds = new Set(tableFolders.flatMap((f) => f.items.map((w) => w.id)));
  const standaloneEndpoints = apiEndpoints.filter((w) => !tableItemIds.has(w.id));

  // ── Search filter ─────────────────────────────────────────────────────────
  const q = search.toLowerCase();
  const filterWf = (w: BackendWorkflow) =>
    !q || w.name.toLowerCase().includes(q) || (w.path ?? '').toLowerCase().includes(q);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const selected = workflows.find((w) => w.id === selectedId) ?? null;

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const openCanvas = (wf: BackendWorkflow) => {
    setSelectedId(wf.id);
  };

  // ── Create ────────────────────────────────────────────────────────────────
  const createWorkflow = async () => {
    if (!newWf.name.trim()) return;
    setSaving(true);
    try {
      const slug = newWf.name.trim().toLowerCase().replace(/\s+/g, '-');
      const res = await backendWorkflows.create(projectId, {
        name: newWf.name.trim(),
        slug,
        kind: newWf.kind,
        method: newWf.kind === 'API_ENDPOINT' ? newWf.method : undefined,
        path:   newWf.kind === 'API_ENDPOINT'
          ? (newWf.path.startsWith('/') ? newWf.path : `/${newWf.path}`)
          : undefined,
      });
      setWorkflows((prev) => [...prev, res.workflow]);
      setShowNewForm(false);
      setNewWf({ name: '', method: 'POST', path: '/', kind: 'API_ENDPOINT' });
      openCanvas(res.workflow);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  // ── Save settings ─────────────────────────────────────────────────────────
  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await backendWorkflows.update(projectId, settingsWf.id, {
        name:   settingsWf.name,
        method: settingsWf.method || undefined,
        path:   settingsWf.path || undefined,
      });
      setWorkflows((prev) => prev.map((w) => w.id === settingsWf.id ? res.workflow : w));
      if (selectedId === settingsWf.id) setSelectedId(res.workflow.id);
      setShowSettings(false);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingSettings(false); }
  };

  const openSettings = (wf: BackendWorkflow) => {
    setSettingsWf({ id: wf.id, name: wf.name, method: wf.method ?? 'POST', path: wf.path ?? '/', kind: wf.kind });
    setShowSettings(true);
  };


  // ── Sub-components ────────────────────────────────────────────────────────
  const WfRow = ({ wf, indent = false }: { wf: BackendWorkflow; indent?: boolean }) => {
    const active = selectedId === wf.id;
    return (
      <div
        onClick={() => openCanvas(wf)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: `6px ${indent ? '28px' : '14px'}`,
          cursor: 'pointer',
          background: active ? 'rgba(79,70,229,0.12)' : 'transparent',
          borderLeft: `2px solid ${active ? '#6366f1' : 'transparent'}`,
        }}
      >
        {wf.method ? (
          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'monospace', flexShrink: 0, padding: '1px 4px', borderRadius: 3, background: `${METHOD_COLORS[wf.method] ?? '#6b7280'}22`, color: METHOD_COLORS[wf.method] ?? '#6b7280' }}>
            {wf.method}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: '#475569', flexShrink: 0 }}>ƒ</span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: active ? '#e2e8f0' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wf.name}</div>
          {wf.path && <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wf.path}</div>}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
            setCtxMenu({ wfId: wf.id, x: rect.right, y: rect.bottom + 4 });
          }}
          style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14, padding: '1px 4px', flexShrink: 0, lineHeight: 1 }}
          title="Options"
        >⋮</button>
      </div>
    );
  };

  const SectionHeader = ({ label, sectionKey, count }: { label: string; sectionKey: string; count: number }) => (
    <button
      onClick={() => toggleCollapse(sectionKey)}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
    >
      <span style={{ fontSize: 10, color: '#475569', display: 'inline-block', transform: collapsed[sectionKey] ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▾</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 10, color: '#334155' }}>{count}</span>
    </button>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* ── Left sidebar ────────────────────────────────────────────────── */}
      <div style={{ width: 280, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', background: '#080d17', flexShrink: 0, overflow: 'hidden' }}>

        {/* Search + Add button */}
        <div style={{ padding: '10px 10px 8px', display: 'flex', gap: 6, borderBottom: '1px solid #1e293b' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              style={{ ...INPUT, fontSize: 11, padding: '5px 8px 5px 28px' }}
            />
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#475569', pointerEvents: 'none' }}>⌕</span>
          </div>
          {workflows.length > 0 && (
            <button
              onClick={async () => {
                if (!confirm('Delete ALL workflows? This cannot be undone.')) return;
                await backendWorkflows.deleteAll(projectId).catch(() => {});
                setWorkflows([]);
                setSelectedId(null);
              }}
              title="Remove all workflows"
              style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', fontSize: 12, background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }}
            >🗑</button>
          )}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowAddMenu((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', fontSize: 12, fontWeight: 600, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            >
              + Add <span style={{ fontSize: 10 }}>▾</span>
            </button>
            {showAddMenu && (
              <div
                style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 50, minWidth: 180 }}
                onMouseLeave={() => setShowAddMenu(false)}
              >
                {(['API_ENDPOINT', 'FUNCTION', 'MIDDLEWARE'] as WfKind[]).map((k) => (
                  <button key={k}
                    onClick={() => { setNewWf((p) => ({ ...p, kind: k })); setShowAddMenu(false); setShowNewForm(true); }}
                    style={{ width: '100%', display: 'block', padding: '9px 14px', background: 'none', border: 'none', color: '#e2e8f0', fontSize: 12, textAlign: 'left', cursor: 'pointer' }}>
                    {k === 'API_ENDPOINT' ? '⟶ API Endpoint' : k === 'FUNCTION' ? 'ƒ Function' : '⊕ Middleware'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Workflow list */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && <div style={{ padding: 16, fontSize: 12, color: '#475569', textAlign: 'center' }}>Loading…</div>}

          {!loading && (
            <>
              {/* ── API Endpoints ── */}
              <SectionHeader label="API Endpoints" sectionKey="api" count={apiEndpoints.length} />
              {!collapsed['api'] && (
                <>
                  {standaloneEndpoints.filter(filterWf).map((wf) => <WfRow key={wf.id} wf={wf} />)}

                  {tableFolders.map((folder) => {
                    const folderKey = `table-${folder.tableName}`;
                    const items = folder.items.filter(filterWf);
                    return (
                      <div key={folder.tableName}>
                        <button
                          onClick={() => toggleCollapse(folderKey)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <span style={{ fontSize: 10, color: '#475569', display: 'inline-block', transform: collapsed[folderKey] ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▾</span>
                          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>📁 {folder.displayName}</span>
                          <span style={{ fontSize: 10, color: '#334155', marginLeft: 'auto' }}>{folder.items.length}</span>
                        </button>
                        {!collapsed[folderKey] && items.map((wf) => <WfRow key={wf.id} wf={wf} indent />)}
                      </div>
                    );
                  })}

                  {apiEndpoints.filter(filterWf).length === 0 && (
                    <div style={{ padding: '6px 14px 10px', fontSize: 11, color: '#334155' }}>No endpoints yet</div>
                  )}
                </>
              )}

              {/* ── Functions ── */}
              <div style={{ marginTop: 4 }}>
                <SectionHeader label="Functions" sectionKey="fn" count={functions.length} />
                {!collapsed['fn'] && (
                  <>
                    {functions.filter(filterWf).map((wf) => <WfRow key={wf.id} wf={wf} />)}
                    {functions.length === 0 && <div style={{ padding: '4px 14px 8px', fontSize: 11, color: '#334155' }}>No functions yet</div>}
                  </>
                )}
              </div>

              {/* ── Middlewares ── */}
              <div style={{ marginTop: 4 }}>
                <SectionHeader label="Middlewares" sectionKey="mw" count={middlewares.length} />
                {!collapsed['mw'] && (
                  <>
                    {middlewares.filter(filterWf).map((wf) => <WfRow key={wf.id} wf={wf} />)}
                    {middlewares.length === 0 && <div style={{ padding: '4px 14px 8px', fontSize: 11, color: '#334155' }}>No middlewares yet</div>}
                  </>
                )}
              </div>
            </>
          )}
        </div>

      </div>

      {/* ── Center: inline WorkflowCanvas or empty state ─────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header bar for selected workflow */}
        {selected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderBottom: '1px solid #1e293b', background: '#080d17', flexShrink: 0, flexWrap: 'wrap' }}>
            {selected.method && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: `${METHOD_COLORS[selected.method] ?? '#6b7280'}22`, color: METHOD_COLORS[selected.method] ?? '#6b7280' }}>
                {selected.method}
              </span>
            )}
            {selected.kind === 'FUNCTION' && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(107,114,128,0.2)', color: '#9ca3af' }}>INTERNAL</span>
            )}
            {selected.kind === 'MIDDLEWARE' && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.2)', color: '#a78bfa' }}>MIDDLEWARE</span>
            )}
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{selected.name}</span>

            {/* Status badge */}
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, letterSpacing: '0.05em',
              background: selected.status === 'PUBLISHED' ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.2)',
              color: selected.status === 'PUBLISHED' ? '#4ade80' : '#64748b',
              border: `1px solid ${selected.status === 'PUBLISHED' ? 'rgba(34,197,94,0.3)' : 'rgba(100,116,139,0.3)'}`,
            }}>
              {selected.status}
            </span>

            {/* Copy URL (only when published) */}
            {selected.kind === 'API_ENDPOINT' && selected.status === 'PUBLISHED' && (
              <button
                onClick={() => copyEndpointUrl(selected)}
                title="Copy endpoint URL"
                style={{ ...BTN, fontSize: 11, padding: '3px 10px', background: 'rgba(15,23,42,0.8)', color: copied ? '#4ade80' : '#64748b', border: '1px solid #1e293b' }}
              >
                {copied ? '✓ Copied' : '⎘ Copy URL'}
              </button>
            )}

            {/* Security */}
            {selected.kind === 'API_ENDPOINT' && (
              <button
                onClick={() => setSecPopover(selected.id)}
                style={{ ...BTN, fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' }}
              >
                {(() => {
                  const sec = securityState[selected.id];
                  if (!sec) return '⊕ Public';
                  const mid = sec.middlewareIds.length > 0 ? '+WF' : '';
                  return sec.access === 'authenticated' ? `👤 Auth${mid}` : `⊕ Public${mid}`;
                })()}
              </button>
            )}

            {/* Publish / Unpublish */}
            {selected.kind === 'API_ENDPOINT' && (
              <button
                onClick={() => void togglePublish(selected)}
                disabled={publishing === selected.id}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 12px', borderRadius: 5, cursor: 'pointer',
                  border: 'none', opacity: publishing === selected.id ? 0.6 : 1,
                  background: selected.status === 'PUBLISHED' ? 'rgba(239,68,68,0.15)' : '#4f46e5',
                  color: selected.status === 'PUBLISHED' ? '#f87171' : '#fff',
                }}
              >
                {publishing === selected.id ? '…' : selected.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
              </button>
            )}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 13, flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 32, opacity: 0.4 }}>ƒ</span>
              <span>Select a workflow to edit it</span>
            </div>
          ) : (
            <WorkflowCanvas
              key={selected.id}
              target={{ kind: 'serverWorkflow', workflowId: selected.id, projectId }}
              onClose={() => setSelectedId(null)}
              inline
            />
          )}
        </div>
      </div>

      {/* ── Settings modal ───────────────────────────────────────────────── */}
      {showSettings && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 48 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowSettings(false)} />
          <div style={{ position: 'relative', zIndex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', width: 480, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>Settings</span>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Name</label>
                <input value={settingsWf.name} onChange={(e) => setSettingsWf((p) => ({ ...p, name: e.target.value }))} style={INPUT} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Folder</label>
                <select style={{ ...INPUT, cursor: 'pointer' }} defaultValue="">
                  <option value="">Select a folder</option>
                  {tables.map((t) => <option key={t.id} value={t.name}>Table: {t.displayName}</option>)}
                </select>
              </div>

              {settingsWf.kind === 'API_ENDPOINT' && (
                <>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Method</label>
                    <select value={settingsWf.method} onChange={(e) => setSettingsWf((p) => ({ ...p, method: e.target.value }))} style={{ ...INPUT, cursor: 'pointer' }}>
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Path</label>
                    <input value={settingsWf.path} onChange={(e) => setSettingsWf((p) => ({ ...p, path: e.target.value }))} style={INPUT} />
                  </div>
                </>
              )}

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Description</label>
                  <button style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, cursor: 'pointer' }}>✦ Generate</button>
                </div>
                <div style={{ border: '1px solid #334155', borderRadius: 6, overflow: 'hidden', background: '#1e293b' }}>
                  <div style={{ display: 'flex', gap: 2, padding: '5px 8px', borderBottom: '1px solid #334155', flexWrap: 'wrap' }}>
                    {RICH_TOOLBAR_ICONS.map((ic) => (
                      <button key={ic} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 11, padding: '2px 5px', borderRadius: 3 }}>{ic}</button>
                    ))}
                  </div>
                  <textarea rows={4} style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: 13, padding: '10px 12px', resize: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
            </div>

            <div style={{ padding: '12px 18px', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowSettings(false)} style={{ ...BTN, fontSize: 12, padding: '6px 14px' }}>Cancel</button>
              <button onClick={() => void saveSettings()} disabled={savingSettings}
                style={{ fontSize: 12, fontWeight: 600, padding: '6px 16px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: savingSettings ? 0.6 : 1 }}>
                {savingSettings ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Workflow Modal ────────────────────────────────────────── */}
      {showNewForm && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} onClick={() => setShowNewForm(false)} />
          <div style={{ position: 'relative', zIndex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', width: 460 }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
                New {newWf.kind === 'API_ENDPOINT' ? 'API Endpoint' : newWf.kind === 'FUNCTION' ? 'Function' : 'Middleware'}
              </span>
              <button onClick={() => setShowNewForm(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Workflow name *</label>
                <input
                  autoFocus value={newWf.name}
                  onChange={(e) => setNewWf((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Enter a name…"
                  style={INPUT}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Folder</label>
                <select style={{ ...INPUT, cursor: 'pointer' }} defaultValue="">
                  <option value="">Select a folder</option>
                  {tables.map((t) => <option key={t.id} value={t.name}>{t.displayName ?? t.name}</option>)}
                </select>
              </div>
              {newWf.kind === 'API_ENDPOINT' && (
                <>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>HTTP Method *</label>
                    <select value={newWf.method} onChange={(e) => setNewWf((p) => ({ ...p, method: e.target.value }))} style={{ ...INPUT, cursor: 'pointer' }}>
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Path *</label>
                    <input value={newWf.path} onChange={(e) => setNewWf((p) => ({ ...p, path: e.target.value }))} placeholder="/api/endpoint" style={INPUT} />
                  </div>
                </>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => setShowNewForm(false)} style={{ ...BTN, fontSize: 12, padding: '6px 14px' }}>← Previous</button>
              <button
                onClick={() => void createWorkflow()}
                disabled={saving || !newWf.name.trim()}
                style={{ fontSize: 12, fontWeight: 600, padding: '6px 20px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: saving || !newWf.name.trim() ? 0.6 : 1 }}
              >
                {saving ? 'Creating…' : 'Continue →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Context menu ─────────────────────────────────────────────── */}
      {ctxMenu && (() => {
        const wf = workflows.find((w) => w.id === ctxMenu.wfId);
        if (!wf) return null;
        const menuStyle: React.CSSProperties = {
          position: 'fixed', top: ctxMenu.y, left: ctxMenu.x - 160,
          background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 300, minWidth: 160,
        };
        const itemStyle: React.CSSProperties = {
          display: 'block', width: '100%', padding: '8px 14px', background: 'none',
          border: 'none', color: '#e2e8f0', fontSize: 12, textAlign: 'left', cursor: 'pointer',
        };
        const closeCtx = () => setCtxMenu(null);
        return (
          <div style={menuStyle} onMouseLeave={closeCtx}>
            <button style={itemStyle} onClick={() => { openSettings(wf); closeCtx(); }}>Rename workflow</button>
            <button style={itemStyle} onClick={async () => {
              try {
                const slug = `${wf.slug ?? wf.name.toLowerCase().replace(/\s+/g, '-')}-copy`;
                const res = await backendWorkflows.create(projectId, { name: `${wf.name} (copy)`, slug, kind: wf.kind, method: wf.method, path: wf.path });
                setWorkflows((p) => [...p, res.workflow]);
              } catch { /* ignore */ }
              closeCtx();
            }}>Copy workflow</button>
            <button style={itemStyle} onClick={() => {
              const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';
              const url = `${base}/v1/run/${projectId}/${wf.slug ?? wf.id}`;
              navigator.clipboard.writeText(url).catch(() => {});
              closeCtx();
            }}>Copy endpoint URL</button>
            {wf.kind === 'API_ENDPOINT' && (
              <button style={itemStyle} onClick={() => {
                const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';
                const url = `${base}/v1/run/${projectId}/${wf.slug ?? wf.id}`;
                const method = wf.method ?? 'GET';
                const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
                const isDelete = method === 'DELETE';
                const hasId = wf.path?.includes(':id');

                // Build body template from table columns
                let bodyTemplate = '{}';
                if (hasBody || isDelete) {
                  const linkedTable = tables.find((t) => t.id === wf.autoGroupTableId);
                  if (linkedTable?.columns?.length) {
                    const userCols = linkedTable.columns.filter(
                      (c) => !['id', 'created_at', 'updated_at'].includes(c.name),
                    );
                    if (isDelete || (hasId && !hasBody)) {
                      bodyTemplate = JSON.stringify({ id: '' });
                    } else {
                      const sample: Record<string, string> = {};
                      if (hasId) sample['id'] = '';
                      userCols.forEach((c) => { sample[c.name] = ''; });
                      bodyTemplate = JSON.stringify(sample, null, 2);
                    }
                  }
                }

                const curl = [
                  `curl -X ${method}`,
                  `  "${url}"`,
                  `  -H "Content-Type: application/json"`,
                  (hasBody || (isDelete && hasId)) ? `  -d '${bodyTemplate}'` : null,
                ].filter(Boolean).join(' \\\n');
                navigator.clipboard.writeText(curl).catch(() => {});
                closeCtx();
              }}>Copy as cURL</button>
            )}
            <button style={{ ...itemStyle, color: '#ef4444' }} onClick={async () => {
              if (!confirm(`Delete "${wf.name}"?`)) return;
              await backendWorkflows.delete(projectId, wf.id).catch(() => {});
              setWorkflows((p) => p.filter((w) => w.id !== wf.id));
              if (selectedId === wf.id) setSelectedId(null);
              closeCtx();
            }}>Delete workflow</button>
          </div>
        );
      })()}

      {/* ── Security Popover ─────────────────────────────────────────── */}
      {secPopover && (() => {
        const wf = workflows.find((w) => w.id === secPopover);
        if (!wf) return null;
        const sec = securityState[secPopover] ?? { access: 'public', middlewareIds: [] };
        const setSec = (patch: Partial<typeof sec>) => setSecurityState((p) => ({ ...p, [secPopover]: { ...sec, ...patch } }));
        const mwList = middlewares;
        return (
          <div style={{ position: 'absolute', inset: 0, zIndex: 250 }} onClick={() => setSecPopover(null)}>
            <div
              style={{
                position: 'absolute', top: 80, right: 20,
                background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)', width: 320, padding: 14,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Security</span>
                <button onClick={() => setSecPopover(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}>✕</button>
              </div>
              {/* Access dropdown */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Access</label>
                <select
                  style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#e2e8f0', outline: 'none', width: '100%', cursor: 'pointer' }}
                  value={sec.access}
                  onChange={(e) => setSec({ access: e.target.value as 'public' | 'authenticated' })}
                >
                  <option value="public">⊕ Public — Anyone can call</option>
                  <option value="authenticated">👤 Authenticated — Requires valid session</option>
                </select>
              </div>
              {/* Middleware chain */}
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>Middleware chain</label>
                {sec.middlewareIds.map((mwId, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#475569', width: 28 }}>and</span>
                    <select
                      style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 5, padding: '5px 8px', fontSize: 11, color: '#e2e8f0', outline: 'none', cursor: 'pointer' }}
                      value={mwId}
                      onChange={(e) => {
                        const ids = [...sec.middlewareIds];
                        ids[i] = e.target.value;
                        setSec({ middlewareIds: ids });
                      }}
                    >
                      <option value="">Select middleware</option>
                      {mwList.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <button
                      onClick={() => setSec({ middlewareIds: sec.middlewareIds.filter((_, j) => j !== i) })}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}
                    >✕</button>
                  </div>
                ))}
                <button
                  onClick={() => setSec({ middlewareIds: [...sec.middlewareIds, ''] })}
                  style={{ fontSize: 11, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4 }}
                >+ Add middleware for more control</button>
              </div>
              {/* Save */}
              <button
                onClick={async () => {
                  try {
                    await backendWorkflows.update(projectId, secPopover, { securityPolicy: sec });
                    setSecPopover(null);
                  } catch { /* ignore */ }
                }}
                style={{ marginTop: 14, width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >Save</button>
            </div>
          </div>
        );
      })()}

      {/* Error toast */}
      {error && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: '#7f1d1d', color: '#fca5a5', padding: '8px 16px', borderRadius: 6, fontSize: 12, zIndex: 200, display: 'flex', gap: 8 }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}
