'use client';
/**
 * Backend Workflows Panel — WeWeb-style layout.
 *
 * Layout:
 *   Left sidebar (280px): search + "+ Add <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg>" | collapsible sections
 *                         API Endpoints (table folders + standalone)
 *                         Functions  |  Middlewares
 *   Center (flex-1):     WorkflowCanvas rendered inline (not full-screen overlay)
 *   Right mini-panel (220px): method + name + path + Public / Settings buttons
 *
 * Settings modal: Name, Folder, Method, Path, Description
 */
import React, { useState, useEffect, useCallback } from 'react';
import { SearchInput } from './_panel-primitives';
import {
  backendWorkflows, backendTables,
  type BackendWorkflow,
} from '@/lib/platform/api-client';
import { useBackendConfig, patchCachedWorkflows } from '@/lib/builder/use-backend-config';
import { WorkflowCanvas } from './_workflow-canvas';
import { useBuilderStore, type DataSourceConfig } from './_store';

// ─── Constants ────────────────────────────────────────────────────────────────

type WfKind = 'API_ENDPOINT' | 'FUNCTION' | 'MIDDLEWARE';

const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--bld-success)', POST: 'var(--bld-accent)', PUT: 'var(--bld-warning)',
  PATCH: 'var(--bld-accent)', DELETE: 'var(--bld-error)',
};

const BTN: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '4px 10px', fontSize: 11, fontWeight: 500,
  background: 'transparent', color: 'var(--bld-text-3)',
  border: '1px solid var(--bld-border)', borderRadius: 5,
  cursor: 'pointer', whiteSpace: 'nowrap',
};

const INPUT: React.CSSProperties = {
  background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6,
  padding: '7px 10px', fontSize: 12, color: 'var(--bld-text-2)', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};

const RICH_TOOLBAR_ICONS = ['T', 'B', 'I', 'S̶', '🔗', '≡', '1.', '""', '<>', '⎖', '▶'];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { projectId: string; }

export function ServerWorkflowsPanel({ projectId }: Props) {

  // Shared backend config cache — one request shared with all other panels.
  const { workflows: cachedWorkflows, loading } = useBackendConfig(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError]           = useState('');

  // active sidebar tab
  const [activeTab, setActiveTab] = useState<'api' | 'fn' | 'mw'>('api');

  // collapsed state per section key — folders start collapsed by default
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // search
  const [search, setSearch] = useState('');

  // add new workflow
  const [showAddMenu, setShowAddMenu]   = useState(false);
  const [saving, setSaving]             = useState(false);
  const [newWf, setNewWf]               = useState({
    name: '', method: 'POST', path: '/', kind: 'API_ENDPOINT' as WfKind, folder: '',
  });
  const [showNewForm, setShowNewForm]   = useState(false);

  // settings modal
  const [showSettings, setShowSettings] = useState(false);
  const [settingsWf, setSettingsWf]     = useState<{
    id: string; name: string; method: string; path: string; kind: string; folder: string;
  }>({ id: '', name: '', method: 'POST', path: '/', kind: 'API_ENDPOINT', folder: '' });

  const [savingSettings, setSavingSettings] = useState(false);

  const [copied, setCopied] = useState(false);

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
  const [secPopoverAnchor, setSecPopoverAnchor] = useState<{ top: number; right: number } | null>(null);
  const [securityState, setSecurityState] = useState<Record<string, { access: 'public' | 'authenticated'; middlewareIds: string[] }>>({});


  // Sync security state whenever the cached workflows change.
  const workflows = cachedWorkflows;

  // "Add All to Data Sources" — adds every published API endpoint as a datasource
  const [allAdded, setAllAdded] = useState(false);
  const { pageDataSources, addPageDataSource, addDsFolder, dsFolders } = useBuilderStore();
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

  const handleAddAllToDataSources = useCallback(async () => {
    if (allAdded) return;
    const publishedApis = workflows.filter(w => w.kind === 'API_ENDPOINT' && w.status === 'PUBLISHED');
    if (publishedApis.length === 0) return;
    try {
      const { tables } = await backendTables.list(projectId);
      const folderIdMap: Record<string, string> = {};
      tables.forEach(t => {
        const folderId = `be-folder-${t.id}`;
        if (!dsFolders.find(f => f.id === folderId)) {
          addDsFolder({ id: folderId, name: t.displayName, parentId: undefined });
        }
        folderIdMap[t.id] = folderId;
      });
      publishedApis.forEach(wf => {
        const id = `backend-${wf.id}`;
        if (pageDataSources.find(d => d.id === id)) return;
        const folderId = wf.autoGroupTableId ? folderIdMap[wf.autoGroupTableId] : undefined;
        addPageDataSource({
          id,
          name: wf.name,
          type: 'rest',
          method: (wf.method ?? 'GET') as DataSourceConfig['method'],
          url: `${BACKEND_URL}/v1/run/${projectId}/${wf.slug ?? wf.id}`,
          trigger: 'action',
          storeIn: id,
          folderId,
        } as DataSourceConfig);
      });
      setAllAdded(true);
    } catch { /* non-fatal */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAdded, projectId, workflows, pageDataSources, dsFolders]);
  useEffect(() => {
    const initial: Record<string, { access: 'public' | 'authenticated'; middlewareIds: string[] }> = {};
    for (const wf of workflows) {
      initial[wf.id] = {
        access: wf.security === 'AUTHENTICATED' ? 'authenticated' : 'public',
        middlewareIds: wf.middlewareIds ?? [],
      };
    }
    setSecurityState(initial);
    // Collapse all folders by default when data loads
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const wf of workflows) {
        if (wf.folder) {
          const key = `folder-${wf.folder}`;
          if (!(key in next)) next[key] = true;
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflows]);

  // ── Derive groups ─────────────────────────────────────────────────────────
  const apiEndpoints = workflows.filter((w) => w.kind === 'API_ENDPOINT');
  const functions    = workflows.filter((w) => w.kind === 'FUNCTION');
  const middlewares  = workflows.filter((w) => w.kind === 'MIDDLEWARE');

  // Free-form folder grouping — any workflow can have a folder string
  type WfFolder = { name: string; items: BackendWorkflow[] };
  const folderMap = new Map<string, BackendWorkflow[]>();
  const standaloneEndpoints: BackendWorkflow[] = [];
  for (const wf of apiEndpoints) {
    const f = wf.folder?.trim();
    if (f) {
      if (!folderMap.has(f)) folderMap.set(f, []);
      folderMap.get(f)!.push(wf);
    } else {
      standaloneEndpoints.push(wf);
    }
  }
  const namedFolders: WfFolder[] = Array.from(folderMap.entries()).map(([name, items]) => ({ name, items }));

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
        name:   newWf.name.trim(),
        slug,
        kind:   newWf.kind,
        folder: newWf.folder.trim() || undefined,
        method: newWf.kind === 'API_ENDPOINT' ? newWf.method : undefined,
        path:   newWf.kind === 'API_ENDPOINT'
          ? (newWf.path.startsWith('/') ? newWf.path : `/${newWf.path}`)
          : undefined,
      });
      patchCachedWorkflows(projectId, (prev) => [...prev, res.workflow]);
      setShowNewForm(false);
      setNewWf({ name: '', method: 'POST', path: '/', kind: 'API_ENDPOINT', folder: '' });
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
        folder: settingsWf.folder.trim() || undefined,
      });
      patchCachedWorkflows(projectId, (prev) => prev.map((w) => w.id === res.workflow.id ? res.workflow : w));
      if (selectedId === settingsWf.id) setSelectedId(res.workflow.id);
      setShowSettings(false);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingSettings(false); }
  };

  const openSettings = (wf: BackendWorkflow) => {
    setSettingsWf({ id: wf.id, name: wf.name, method: wf.method ?? 'POST', path: wf.path ?? '/', kind: wf.kind, folder: wf.folder ?? '' });
    setShowSettings(true);
  };


  // ── Sub-components ────────────────────────────────────────────────────────
  const WfRow = ({ wf, indent = false }: { wf: BackendWorkflow; indent?: boolean }) => {
    const active = selectedId === wf.id;
    const methodColor = wf.method ? (METHOD_COLORS[wf.method] ?? 'var(--bld-text-disabled)') : null;
    return (
      <div
        onClick={() => openCanvas(wf)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: `5px ${indent ? '24px' : '10px'} 5px ${indent ? '24px' : '10px'}`,
          cursor: 'pointer',
          background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
          transition: 'background 0.12s',
          margin: '1px 6px',
          borderRadius: 6,
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        {wf.method ? (
          <span style={{
            fontSize: 9, fontWeight: 700, fontFamily: 'monospace', flexShrink: 0,
            padding: '2px 5px', borderRadius: 4,
            background: `${methodColor}22`, color: methodColor ?? 'var(--bld-text-disabled)',
            border: `1px solid ${methodColor ?? 'transparent'}44`,
            minWidth: 36, textAlign: 'center',
          }}>
            {wf.method}
          </span>
        ) : wf.kind === 'FUNCTION' ? (
          <span style={{ width: 28, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 5, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)' }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4c0-1 .5-2 2-2s2 .5 2 2l-1 6c0 1 .5 2 2 2"/><circle cx="3.5" cy="10.5" r="1"/><circle cx="12.5" cy="5.5" r="1"/></svg>
          </span>
        ) : (
          <span style={{ width: 28, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 5, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)' }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="12" height="6" rx="2"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="8" y1="11" x2="8" y2="14"/></svg>
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: active ? '#fff' : 'rgba(255,255,255,0.75)', fontWeight: active ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wf.name}</div>
          {wf.path && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wf.path}</div>}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
            setCtxMenu({ wfId: wf.id, x: rect.right, y: rect.bottom + 4 });
          }}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 16, padding: '1px 4px', flexShrink: 0, lineHeight: 1 }}
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
      <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', display: 'inline-block', transform: collapsed[sectionKey] ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg></span>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-3)', textTransform: 'none', flex: 1 }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)' }}>{count}</span>
    </button>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      flex: 1, display: 'flex', height: '100%', overflow: 'hidden', position: 'relative',
    }}>

      {/* ── Left sidebar ────────────────────────────────────────────────── */}
      <div style={{
        width: 300, borderRight: '1px solid var(--bld-bg-elevated)',
        display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
        backgroundColor: 'var(--bld-bg-panel)',
        backgroundImage: 'radial-gradient(ellipse 160% 40% at 50% 100%, rgba(99,102,241,0.07) 0%, transparent 60%)',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 14px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--bld-glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 8h3l2-4 3 8 2-4h2"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--bld-text-2)', letterSpacing: 0.3 }}>API</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => { const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'; window.open(`${base}/v1/projects/${projectId}/docs`, '_blank'); }}
              title="Open Swagger docs"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', fontSize: 10, fontWeight: 600, background: 'rgba(34,197,94,0.1)', color: 'var(--bld-success)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 5, cursor: 'pointer' }}>
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8" cy="8" r="6"/><line x1="8" y1="4" x2="8" y2="8"/><line x1="8" y1="11" x2="8" y2="12"/></svg>
              Docs
            </button>
            {apiEndpoints.filter(w => w.status === 'PUBLISHED').length > 0 && (
              <button
                onClick={handleAddAllToDataSources}
                disabled={allAdded}
                title="Add all published endpoints as data sources"
                style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 7px', fontSize: 10, fontWeight: 600, background: allAdded ? 'transparent' : 'rgba(99,102,241,0.12)', color: allAdded ? 'var(--bld-text-disabled)' : 'var(--bld-accent)', border: `1px solid ${allAdded ? 'var(--bld-border)' : 'rgba(99,102,241,0.3)'}`, borderRadius: 5, cursor: allAdded ? 'default' : 'pointer' }}>
                {allAdded ? '✓ Added' : '+ DS'}
              </button>
            )}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              {showAddMenu && <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setShowAddMenu(false)} />}
              <button onClick={() => setShowAddMenu((v) => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', fontSize: 11, fontWeight: 600, background: 'var(--bld-accent)', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>
                + Add
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 6 8 10 12 6"/></svg>
              </button>
              {showAddMenu && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: 'var(--bld-bg-base)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.6)', zIndex: 50, minWidth: 200, backdropFilter: 'blur(16px)', overflow: 'hidden', padding: '4px' }}>
                  {([
                    { k: 'API_ENDPOINT' as WfKind, label: 'API Endpoint', desc: 'HTTP route with method & path', icon: (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
                    )},
                    { k: 'FUNCTION' as WfKind, label: 'Function', desc: 'Internal reusable logic', icon: (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4c0-1 .5-2 2-2s2 .5 2 2l-1 6c0 1 .5 2 2 2"/><circle cx="3.5" cy="10.5" r="1"/><circle cx="12.5" cy="5.5" r="1"/></svg>
                    )},
                    { k: 'MIDDLEWARE' as WfKind, label: 'Middleware', desc: 'Runs before matched routes', icon: (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="12" height="6" rx="2"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="8" y1="11" x2="8" y2="14"/></svg>
                    )},
                  ]).map(({ k, label, desc, icon }) => (
                    <button key={k}
                      onClick={() => { setNewWf((p) => ({ ...p, kind: k })); setShowAddMenu(false); setShowNewForm(true); }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'transparent', border: 'none', borderRadius: 7, color: 'var(--bld-text-2)', fontSize: 12, textAlign: 'left', cursor: 'pointer' }}>
                      <div style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>{icon}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--bld-text-1)' }}>{label}</div>
                        <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginTop: 1 }}>{desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs: API Endpoints | Functions | Middlewares */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--bld-bg-elevated)', flexShrink: 0 }}>
          {([
            { key: 'api', label: 'Endpoints', count: apiEndpoints.length },
            { key: 'fn',  label: 'Functions', count: functions.length },
            { key: 'mw',  label: 'Middleware', count: middlewares.length },
          ] as const).map(({ key, label, count }) => {
            const active = activeTab === key;
            return (
              <button key={key} onClick={() => setActiveTab(key)} style={{
                flex: 1, padding: '8px 4px', fontSize: 10, fontWeight: active ? 700 : 500,
                color: active ? 'var(--bld-accent)' : 'rgba(255,255,255,0.55)',
                background: 'none', border: 'none', borderBottom: `2px solid ${active ? 'var(--bld-accent)' : 'transparent'}`,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                transition: 'color 0.12s',
              }}>
                {label}
                <span style={{ fontSize: 9, background: active ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.08)', color: active ? 'var(--bld-accent)' : 'rgba(255,255,255,0.4)', borderRadius: 8, padding: '1px 5px' }}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search…" />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && <div style={{ padding: 16, fontSize: 12, color: 'var(--bld-text-disabled)', textAlign: 'center' }}>Loading…</div>}

          {!loading && activeTab === 'api' && (
            <>
              {namedFolders.map((folder) => {
                const folderKey = `folder-${folder.name}`;
                const isOpen = !collapsed[folderKey];
                const items = folder.items.filter(filterWf);
                return (
                  <div key={folder.name}>
                    <button onClick={() => toggleCollapse(folderKey)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ flexShrink: 0, transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
                        <polyline points="4 6 8 10 12 6"/>
                      </svg>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        {isOpen
                          ? <path d="M2 6.5A1.5 1.5 0 013.5 5h3L8 6.5h4.5A1.5 1.5 0 0114 8v4.5A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5V6.5z"/>
                          : <path d="M2 4.5A1.5 1.5 0 013.5 3h3L8 5h4.5A1.5 1.5 0 0114 6.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 13V4.5z"/>}
                      </svg>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 500, flex: 1 }}>{folder.name}</span>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{folder.items.length}</span>
                    </button>
                    {isOpen && items.map((wf) => <WfRow key={wf.id} wf={wf} indent />)}
                  </div>
                );
              })}
              {standaloneEndpoints.filter(filterWf).map((wf) => <WfRow key={wf.id} wf={wf} />)}
              {apiEndpoints.filter(filterWf).length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', boxShadow: '0 0 20px rgba(99,102,241,0.1)' }}>
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', marginBottom: 4 }}>No endpoints yet</div>
                    <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>Click <strong style={{ color: 'var(--bld-text-3)' }}>+ Add</strong> to create your first API endpoint.</div>
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && activeTab === 'fn' && (
            <>
              {functions.filter(filterWf).map((wf) => <WfRow key={wf.id} wf={wf} />)}
              {functions.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', boxShadow: '0 0 20px rgba(251,191,36,0.08)' }}>
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#fbbf24" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4c0-1 .5-2 2-2s2 .5 2 2l-1 6c0 1 .5 2 2 2"/><circle cx="3.5" cy="10.5" r="1"/><circle cx="12.5" cy="5.5" r="1"/></svg>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', marginBottom: 4 }}>No functions yet</div>
                    <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>Functions are internal helpers reusable across your backend.</div>
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && activeTab === 'mw' && (
            <>
              {middlewares.filter(filterWf).map((wf) => <WfRow key={wf.id} wf={wf} />)}
              {middlewares.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px', gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', boxShadow: '0 0 20px rgba(167,139,250,0.08)' }}>
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#a78bfa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="12" height="6" rx="2"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="8" y1="11" x2="8" y2="14"/></svg>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', marginBottom: 4 }}>No middleware yet</div>
                    <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>Middleware runs before matched routes for auth, logging, etc.</div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Center: inline WorkflowCanvas or empty state ─────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bld-bg-canvas)', backgroundImage: 'radial-gradient(ellipse 70% 50% at 85% 8%, rgba(99,102,241,0.08) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 10% 95%, rgba(124,58,237,0.07) 0%, transparent 55%)' }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {!selected ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
                boxShadow: '0 0 32px rgba(99,102,241,0.12)',
              }}>
                <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 8h3l2-4 3 8 2-4h2"/>
                </svg>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--bld-text-2)', marginBottom: 6 }}>Select a workflow</div>
                <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)', maxWidth: 280, lineHeight: 1.6 }}>
                  Choose an API endpoint, function, or middleware from the list to edit its steps.
                </div>
              </div>
            </div>
          ) : (
            <WorkflowCanvas
              key={selected.id}
              target={{ kind: 'serverWorkflow', workflowId: selected.id, projectId }}
              onClose={() => setSelectedId(null)}
              inline
              hideHeader
              rightPanelHeaderSlot={selected.kind === 'API_ENDPOINT' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {selected.status === 'PUBLISHED' && (
                    <button onClick={() => copyEndpointUrl(selected)} title="Copy endpoint URL"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', fontSize: 10, fontWeight: 500, background: 'rgba(255,255,255,0.05)', color: copied ? 'var(--bld-success)' : 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, cursor: 'pointer' }}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="9" height="9" rx="1.5"/><path d="M3 12H2.5A1.5 1.5 0 011 10.5v-7A1.5 1.5 0 012.5 2h7A1.5 1.5 0 0111 3.5V4"/></svg>
                      {copied ? '✓' : 'Copy'}
                    </button>
                  )}
                  <button onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSecPopoverAnchor({ top: r.bottom + 6, right: window.innerWidth - r.right }); setSecPopover(selected.id); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', fontSize: 10, fontWeight: 600, border: '1px solid', borderRadius: 5, cursor: 'pointer', background: 'rgba(255,255,255,0.05)',
                      borderColor: (() => { const sec = securityState[selected.id]; const hasMW = (sec?.middlewareIds ?? []).filter(Boolean).length > 0; return (sec?.access === 'authenticated' || hasMW) ? 'rgba(248,113,113,0.35)' : 'rgba(34,197,94,0.35)'; })(),
                      color: (() => { const sec = securityState[selected.id]; const hasMW = (sec?.middlewareIds ?? []).filter(Boolean).length > 0; return (sec?.access === 'authenticated' || hasMW) ? '#f87171' : 'var(--bld-success)'; })() }}>
                    {(() => {
                      const sec = securityState[selected.id];
                      const hasMW = (sec?.middlewareIds ?? []).filter(Boolean).length > 0;
                      if (!sec || (sec.access === 'public' && !hasMW)) return <><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="8" y1="5" x2="8" y2="11"/></svg>Public</>;
                      return hasMW
                        ? <><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/></svg>Protected</>
                        : <><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="6" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>Auth</>;
                    })()}
                  </button>
                </div>
              ) : undefined}
            />
          )}
        </div>
      </div>

      {/* ── Settings modal ───────────────────────────────────────────────── */}
      {showSettings && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 48 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowSettings(false)} />
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bld-bg-base)', border: '1px solid var(--bld-border)', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', width: 480, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ padding: '14px 18px', borderBottom: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--bld-text-2)' }}>Settings</span>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 6 }}>Name</label>
                <input value={settingsWf.name} onChange={(e) => setSettingsWf((p) => ({ ...p, name: e.target.value }))} style={INPUT} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 6 }}>Folder <span style={{ fontWeight: 400, color: 'var(--bld-text-disabled)' }}>(optional)</span></label>
                <input
                  value={settingsWf.folder}
                  onChange={(e) => setSettingsWf((p) => ({ ...p, folder: e.target.value }))}
                  placeholder="e.g. Auth, Products, Admin…"
                  style={INPUT}
                />
              </div>

              {settingsWf.kind === 'API_ENDPOINT' && (
                <>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 6 }}>Method</label>
                    <select value={settingsWf.method} onChange={(e) => setSettingsWf((p) => ({ ...p, method: e.target.value }))} style={{ ...INPUT, cursor: 'pointer' }}>
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 6 }}>Path</label>
                    <input value={settingsWf.path} onChange={(e) => setSettingsWf((p) => ({ ...p, path: e.target.value }))} style={INPUT} />
                  </div>
                </>
              )}

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)' }}>Description</label>
                  <button style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(99,102,241,0.15)', color: 'var(--bld-accent)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, cursor: 'pointer' }}>✦ Generate</button>
                </div>
                <div style={{ border: '1px solid var(--bld-border-subtle)', borderRadius: 6, overflow: 'hidden', background: 'var(--bld-bg-elevated)' }}>
                  <div style={{ display: 'flex', gap: 2, padding: '5px 8px', borderBottom: '1px solid var(--bld-border-subtle)', flexWrap: 'wrap' }}>
                    {RICH_TOOLBAR_ICONS.map((ic) => (
                      <button key={ic} style={{ background: 'none', border: 'none', color: 'var(--bld-text-3)', cursor: 'pointer', fontSize: 11, padding: '2px 5px', borderRadius: 3 }}>{ic}</button>
                    ))}
                  </div>
                  <textarea rows={4} style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: 'var(--bld-text-2)', fontSize: 13, padding: '10px 12px', resize: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
            </div>

            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--bld-bg-elevated)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowSettings(false)} style={{ ...BTN, fontSize: 12, padding: '6px 14px' }}>Cancel</button>
              <button onClick={() => void saveSettings()} disabled={savingSettings}
                style={{ fontSize: 12, fontWeight: 600, padding: '6px 16px', background: 'var(--bld-accent)', color: 'var(--bld-accent-fg)', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: savingSettings ? 0.6 : 1 }}>
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
          <div style={{ position: 'relative', zIndex: 1, background: 'var(--bld-bg-base)', border: '1px solid var(--bld-border)', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', width: 460 }}>
            <div style={{ padding: '14px 18px', borderBottom: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--bld-text-2)' }}>
                New {newWf.kind === 'API_ENDPOINT' ? 'API Endpoint' : newWf.kind === 'FUNCTION' ? 'Function' : 'Middleware'}
              </span>
              <button onClick={() => setShowNewForm(false)} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 6 }}>Workflow name *</label>
                <input
                  autoFocus value={newWf.name}
                  onChange={(e) => setNewWf((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Enter a name…"
                  style={INPUT}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 6 }}>Folder <span style={{ fontWeight: 400, color: 'var(--bld-text-disabled)' }}>(optional)</span></label>
                <input
                  value={newWf.folder}
                  onChange={(e) => setNewWf((p) => ({ ...p, folder: e.target.value }))}
                  placeholder="e.g. Auth, Products, Admin…"
                  style={INPUT}
                />
              </div>
              {newWf.kind === 'API_ENDPOINT' && (
                <>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 6 }}>HTTP Method *</label>
                    <select value={newWf.method} onChange={(e) => setNewWf((p) => ({ ...p, method: e.target.value }))} style={{ ...INPUT, cursor: 'pointer' }}>
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 6 }}>Path *</label>
                    <input value={newWf.path} onChange={(e) => setNewWf((p) => ({ ...p, path: e.target.value }))} placeholder="/api/endpoint" style={INPUT} />
                  </div>
                </>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--bld-bg-elevated)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={() => setShowNewForm(false)} style={{ ...BTN, fontSize: 12, padding: '6px 14px' }}>← Previous</button>
              <button
                onClick={() => void createWorkflow()}
                disabled={saving || !newWf.name.trim()}
                style={{ fontSize: 12, fontWeight: 600, padding: '6px 20px', background: 'var(--bld-accent)', color: 'var(--bld-accent-fg)', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: saving || !newWf.name.trim() ? 0.6 : 1 }}
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
          background: 'var(--bld-bg-base)', border: '1px solid var(--bld-border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 300, minWidth: 160,
        };
        const itemStyle: React.CSSProperties = {
          display: 'block', width: '100%', padding: '8px 14px', background: 'none',
          border: 'none', color: 'var(--bld-text-2)', fontSize: 12, textAlign: 'left', cursor: 'pointer',
        };
        const closeCtx = () => setCtxMenu(null);
        return (
          <React.Fragment>
          <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={closeCtx} />
          <div style={{ ...menuStyle, zIndex: 300 }}>
            <button style={itemStyle} onClick={() => { openSettings(wf); closeCtx(); }}>Rename workflow</button>
            <button style={itemStyle} onClick={async () => {
              try {
                const slug = `${wf.slug ?? wf.name.toLowerCase().replace(/\s+/g, '-')}-copy`;
                const copyRes = await backendWorkflows.create(projectId, { name: `${wf.name} (copy)`, slug, kind: wf.kind, method: wf.method, path: wf.path });
                patchCachedWorkflows(projectId, (prev) => [...prev, copyRes.workflow]);
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

                // Build body template
                let bodyTemplate = '{}';
                if (hasBody || isDelete) {
                  if (isDelete || (hasId && !hasBody)) {
                    bodyTemplate = JSON.stringify({ id: '' });
                  } else {
                    bodyTemplate = JSON.stringify({}, null, 2);
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
            <button style={{ ...itemStyle, color: 'var(--bld-error)' }} onClick={async () => {
              if (!confirm(`Delete "${wf.name}"?`)) return;
              await backendWorkflows.delete(projectId, wf.id).catch(() => {});
              patchCachedWorkflows(projectId, (prev) => prev.filter((w) => w.id !== wf.id));
              if (selectedId === wf.id) setSelectedId(null);
              closeCtx();
            }}>Delete workflow</button>
          </div>
          </React.Fragment>
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
          <div style={{ position: 'fixed', inset: 0, zIndex: 250 }} onClick={() => { setSecPopover(null); setSecPopoverAnchor(null); }}>
            <div
              style={{
                position: 'fixed',
                top: secPopoverAnchor?.top ?? 80,
                right: secPopoverAnchor?.right ?? 20,
                background: 'var(--bld-bg-base)', border: '1px solid var(--bld-border)', borderRadius: 10,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)', width: 320, padding: 14,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>Security</span>
                <button onClick={() => { setSecPopover(null); setSecPopoverAnchor(null); }} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer' }}>✕</button>
              </div>
              {/* Access dropdown */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'var(--bld-text-3)', display: 'block', marginBottom: 4 }}>Access</label>
                <select
                  style={{ background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'var(--bld-text-2)', outline: 'none', width: '100%', cursor: 'pointer' }}
                  value={sec.access}
                  onChange={(e) => setSec({ access: e.target.value as 'public' | 'authenticated' })}
                >
                  <option value="public">⊕ Public — Anyone can call</option>
                  <option value="authenticated">👤 Authenticated — Requires valid session</option>
                </select>
              </div>
              {/* Middleware chain */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--bld-text-3)', display: 'block', marginBottom: 4 }}>Middleware chain</label>
                {sec.middlewareIds.map((mwId, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', width: 28 }}>and</span>
                    <select
                      style={{ flex: 1, background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 5, padding: '5px 8px', fontSize: 11, color: 'var(--bld-text-2)', outline: 'none', cursor: 'pointer' }}
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
                      style={{ background: 'none', border: 'none', color: 'var(--bld-error)', cursor: 'pointer', fontSize: 14 }}
                    >✕</button>
                  </div>
                ))}
                <button
                  onClick={() => setSec({ middlewareIds: [...sec.middlewareIds, ''] })}
                  style={{ fontSize: 11, color: 'var(--bld-accent)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4 }}
                >+ Add middleware for more control</button>
              </div>
              {/* Save */}
              <button
                onClick={async () => {
                  try {
                    const secRes = await backendWorkflows.update(projectId, secPopover, {
                      security:     sec.access === 'authenticated' ? 'AUTHENTICATED' : 'PUBLIC',
                      middlewareIds: sec.middlewareIds.filter(Boolean),
                    });
                    patchCachedWorkflows(projectId, (prev) => prev.map((w) => w.id === secRes.workflow.id ? secRes.workflow : w));
                    setSecPopover(null);
                    setSecPopoverAnchor(null);
                  } catch { /* ignore */ }
                }}
                style={{ marginTop: 14, width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600, background: 'var(--bld-accent)', color: 'var(--bld-accent-fg)', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >Save</button>
            </div>
          </div>
        );
      })()}

      {/* Error toast */}
      {error && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(248,113,113,0.15)', color: 'var(--bld-error)', padding: '8px 16px', borderRadius: 6, fontSize: 12, zIndex: 200, display: 'flex', gap: 8 }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: 'var(--bld-error)', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}
