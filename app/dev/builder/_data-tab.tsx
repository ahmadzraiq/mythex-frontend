'use client';

/**
 * Data Tab — left panel "Data" tab.
 *
 * Sections:
 *   A. Data Sources  — named REST/GraphQL sources with bind-button enabled form
 *   B. Variables     — named typed variables (CustomVars)
 */

import React, { useState, useCallback, useRef, lazy, Suspense, useEffect } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import { backendWorkflows, type BackendWorkflow } from '@/lib/platform/api-client';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

const CodeMirror = lazy(() => import('@uiw/react-codemirror'));
import ReactDOM from 'react-dom';
import { useBuilderStore, type DataSourceConfig, type DataSourceParam, type CustomVar, type Folder, persistPreviewData } from './_store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL } from './_slide-panel';
// Thin SVG chevron — rotated via CSS transform to point in any direction
function Chevron({ open, size = 12, color = 'currentColor', style }: { open?: boolean; size?: number; color?: string; style?: React.CSSProperties }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', ...style }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// FORMULA_ANCHOR_LEFT and SLIDE_DEFAULT are imported from _data-source-form (used there too)

// ─── JsonTree — expandable JSON result viewer ─────────────────────────────────

// ─── Extracted modules ───────────────────────────────────────────────────────
import {
  type FormulaFieldState, type KvEntry,
  SLIDE_DEFAULT, FORMULA_ANCHOR_LEFT, SECTION_HDR, SEC_LABEL, EMPTY, ADD_BTN, TYPE_COLOR,
  SectionRow, KvRow, OnOffRow, SimpleToggleRow,
  useFormulaField, TypePicker, RestForm, GraphQLForm,
  DataSourceSlideContent, FolderPicker,
} from './_data-source-form';
import { YesNoToggle, VariableSlideContent, getDefaultForType, TYPE_BADGE_COLORS } from './_variable-form';


// ─── Slide state types ────────────────────────────────────────────────────────

export type DataTabSlideState =
  | { kind: 'dataSource'; editingId: string | null }
  | { kind: 'variable'; editingName: string | null }
  | null;

// ─── DataSlidePanelContent — rendered inside page.tsx's SlidePanel ────────────

interface DataSlidePanelContentProps {
  slideState: DataTabSlideState;
  onClose: () => void;
  onWidthChange?: (w: number) => void;
}

export function DataSlidePanelContent({ slideState, onClose, onWidthChange }: DataSlidePanelContentProps) {
  const store = useBuilderStore();

  const handleDsSave = useCallback((cfg: DataSourceConfig) => {
    const existing = store.pageDataSources.find(s => s.id === cfg.id);
    if (existing) store.updatePageDataSource(cfg.id, cfg);
    else store.addPageDataSource(cfg);
    onClose();
  }, [store, onClose]);

  const handleVarSave = useCallback((v: CustomVar) => {
    const existing = store.customVars.find(c => c.name === v.name);
    if (existing) store.updateCustomVar(v.name, {
      label: v.label,
      type: v.type,
      initialValue: v.initialValue,
      description: v.description,
      saveInLocalStorage: v.saveInLocalStorage,
      folderId: v.folderId,
    });
    else store.addCustomVar(v);
    onClose();
  }, [store, onClose]);

  if (!slideState) return null;

  if (slideState.kind === 'dataSource') {
    const existing = slideState.editingId
      ? store.pageDataSources.find(s => s.id === slideState.editingId) ?? {}
      : {};
    return <DataSourceSlideContent key={slideState.editingId ?? 'new'} initial={existing} onSave={handleDsSave} onClose={onClose} onWidthChange={onWidthChange} />;
  }

  if (slideState.kind === 'variable') {
    const existing = slideState.editingName
      ? store.customVars.find(v => v.name === slideState.editingName) ?? { isNew: false }
      : { isNew: true };
    const handleVarDelete = slideState.editingName
      ? () => { store.removeCustomVar(slideState.editingName!); onClose(); }
      : undefined;
    return <VariableSlideContent initial={existing} onSave={handleVarSave} onDelete={handleVarDelete} onClose={onClose} />;
  }

  return null;
}

export function getDataSlideTitle(slideState: DataTabSlideState): string {
  if (!slideState) return '';
  if (slideState.kind === 'dataSource') return slideState.editingId ? 'Data Source' : 'New Data Source';
  if (slideState.kind === 'variable') return slideState.editingName ? 'Edit Variable' : 'Add Variable';
  return '';
}

// ─── Main DataTab ─────────────────────────────────────────────────────────────

const SEARCH_INPUT: React.CSSProperties = {
  width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 4,
  padding: '4px 8px', fontSize: 10, color: '#d1d5db', outline: 'none', boxSizing: 'border-box',
};

const SUB_HDR: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase' as const,
  letterSpacing: '0.07em', padding: '4px 12px 2px', background: '#0f172a',
};

// ─── BackendApisSection ───────────────────────────────────────────────────────
// Shows only PUBLISHED API endpoints, grouped by table folder.
// Per-item Add button + Add All button. Scrollable. Never causes PATCH calls.

import { backendTables, type BackendTable } from '@/lib/platform/api-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

const METHOD_COLOR: Record<string, string> = {
  GET: '#4ade80', POST: '#60a5fa', PUT: '#fbbf24', PATCH: '#c4b5fd', DELETE: '#f87171',
};
const METHOD_BG: Record<string, string> = {
  GET: 'rgba(34,197,94,0.12)', POST: 'rgba(59,130,246,0.12)', PUT: 'rgba(245,158,11,0.12)',
  PATCH: 'rgba(139,92,246,0.12)', DELETE: 'rgba(239,68,68,0.12)',
};

function WfItem({ wf, added, onAdd }: { wf: BackendWorkflow; added: boolean; onAdd: () => void }) {
  const m = wf.method ?? 'GET';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px 4px 22px', fontSize: 11 }}>
      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: METHOD_BG[m] ?? METHOD_BG.GET, color: METHOD_COLOR[m] ?? METHOD_COLOR.GET, flexShrink: 0 }}>
        {m}
      </span>
      <span style={{ flex: 1, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {wf.name}
      </span>
      <button
        onClick={onAdd}
        disabled={added}
        title={added ? 'Already added' : 'Add as data source'}
        style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
          cursor: added ? 'default' : 'pointer',
          background: added ? 'transparent' : 'rgba(99,102,241,0.15)',
          color: added ? '#374151' : '#a5b4fc',
          border: `1px solid ${added ? '#1f2937' : 'rgba(99,102,241,0.3)'}`,
        }}
      >{added ? '✓' : '+'}</button>
    </div>
  );
}

function BackendApisSection({ projectId, onAdd, onAddAll }: {
  projectId: string;
  onAdd: (wf: BackendWorkflow, folderId?: string) => void;
  onAddAll: (wfs: BackendWorkflow[], tables: BackendTable[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const [wfs, setWfs] = useState<BackendWorkflow[]>([]);
  const [tables, setTables] = useState<BackendTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [allAdded, setAllAdded] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      backendWorkflows.list(projectId, { kind: 'API_ENDPOINT' }),
      backendTables.list(projectId).catch(() => ({ tables: [] as BackendTable[] })),
    ])
      .then(([wfRes, tblRes]) => {
        // Only show published endpoints
        setWfs(wfRes.workflows.filter(w => w.status === 'PUBLISHED'));
        setTables(tblRes.tables);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  if (!loading && wfs.length === 0) return null;

  const tableItemIds = new Set(
    tables.flatMap(t => wfs.filter(w => w.autoGroupTableId === t.id).map(w => w.id))
  );
  const standalone = wfs.filter(w => !tableItemIds.has(w.id));

  const toggleFolder = (key: string) =>
    setCollapsedFolders(s => ({ ...s, [key]: !s[key] }));

  const handleAdd = (wf: BackendWorkflow, folderId?: string) => {
    if (addedIds.has(wf.id)) return;
    onAdd(wf, folderId);
    setAddedIds(s => { const n = new Set(s); n.add(wf.id); return n; });
  };

  const handleAddAll = () => {
    if (allAdded) return;
    onAddAll(wfs, tables);
    setAddedIds(new Set(wfs.map(w => w.id)));
    setAllAdded(true);
  };

  return (
    <div style={{ borderBottom: '2px solid #1f2937', display: 'flex', flexDirection: 'column', flex: open ? '1 1 0' : '0 0 auto', minHeight: 0, overflow: 'hidden', transition: 'flex 0.2s' }}>
      <div style={{ ...SECTION_HDR, cursor: 'pointer', flexShrink: 0 }} onClick={() => setOpen(o => !o)}>
        <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Chevron open={open} size={10} color="#6b7280" />
          Backend APIs
          {!loading && <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 400 }}>({wfs.length})</span>}
        </span>
        {!loading && wfs.length > 0 && (
          <div onClick={e => e.stopPropagation()}>
            <button
              onClick={handleAddAll}
              disabled={allAdded}
              style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: allAdded ? 'default' : 'pointer',
                background: allAdded ? 'transparent' : 'rgba(99,102,241,0.15)',
                color: allAdded ? '#374151' : '#a5b4fc',
                border: `1px solid ${allAdded ? '#1f2937' : 'rgba(99,102,241,0.3)'}`,
              }}
            >{allAdded ? '✓ Added' : '+ Add All'}</button>
          </div>
        )}
      </div>
      {open && (
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 4 }}>
          {loading ? (
            <div style={{ padding: '8px 12px', fontSize: 11, color: '#4b5563' }}>Loading…</div>
          ) : (
            <>
              {tables.map(t => {
                const items = wfs.filter(w => w.autoGroupTableId === t.id);
                if (items.length === 0) return null;
                const key = t.id;
                const folderOpen = !collapsedFolders[key];
                return (
                  <div key={key}>
                    <div
                      onClick={() => toggleFolder(key)}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', cursor: 'pointer', userSelect: 'none' as const }}
                    >
                      <span style={{ fontSize: 9, color: '#475569', transform: folderOpen ? 'rotate(0deg)' : 'rotate(-90deg)', display: 'inline-block', transition: 'transform 0.15s' }}>▾</span>
                      <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>📁 {t.displayName}</span>
                      <span style={{ fontSize: 10, color: '#334155', marginLeft: 'auto' }}>{items.length}</span>
                    </div>
                    {folderOpen && items.map(wf => (
                      <WfItem key={wf.id} wf={wf} added={addedIds.has(wf.id)} onAdd={() => handleAdd(wf, `be-folder-${t.id}`)} />
                    ))}
                  </div>
                );
              })}
              {standalone.map(wf => (
                <WfItem key={wf.id} wf={wf} added={addedIds.has(wf.id)} onAdd={() => handleAdd(wf)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface DataTabProps {
  onSetSlide: (s: DataTabSlideState) => void;
  onWidthChange?: (w: number) => void;
}

export function DataTab({ onSetSlide, onWidthChange }: DataTabProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname() ?? '';
  const projectId = searchParams.get('projectId') ??
    (pathname.startsWith('/builder/') ? (pathname.split('/')[2] ?? null) : null) ??
    (pathname.startsWith('/dev/builder') ? (new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('projectId') ?? null) : null);

  const [dsSearch, setDsSearch] = useState('');
  const [varSearch, setVarSearch] = useState('');
  const [dsSearchOpen, setDsSearchOpen] = useState(false);
  const [varSearchOpen, setVarSearchOpen] = useState(false);
  const dsSearchRef = useRef<HTMLInputElement>(null);
  const varSearchRef = useRef<HTMLInputElement>(null);
  const [dsOpen, setDsOpen] = useState(true);
  const [varOpen, setVarOpen] = useState(true);
  const [activeDsId, setActiveDsId] = useState<string | null>(null);
  const { pageDataSources, removePageDataSource, addPageDataSource, updatePageDataSource, customVars, removeCustomVar, addCustomVar, updateCustomVar, varFolders, dsFolders, removeVarFolder, addDsFolder } = useBuilderStore();

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [folderMenu, setFolderMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);

  const toggleFolder = (id: string) => setExpandedFolders(s => ({ ...s, [id]: !s[id] }));

  // Close folder menu on outside click
  React.useEffect(() => {
    if (!folderMenu) return;
    const handler = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenu(null);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [folderMenu]);

  const filteredDs = pageDataSources.filter(s => {
    const displayName = (s as { _label?: string })._label ?? s.name ?? s.id ?? '';
    return displayName.toLowerCase().includes(dsSearch.toLowerCase());
  });

  const filteredVars = customVars.filter(v =>
    v.name?.toLowerCase().includes(varSearch.toLowerCase())
  );

  // Build a folder tree renderer for any item list
  function renderFolderGroup<T extends { folderId?: string }>(
    items: T[],
    renderItem: (item: T, depth: number) => React.ReactNode,
    emptyMsg: string,
    section: 'ds' | 'var',
    searchActive = false
  ) {
    const folders = section === 'var' ? varFolders : dsFolders;
    const roots = folders.filter(f => !f.parentId);
    const childFolders = (parentId: string) => folders.filter(f => f.parentId === parentId);
    const folderItems = (folderId: string) => items.filter(i => i.folderId === folderId);
    const unfoldered = items.filter(i => !i.folderId);

    // When searching, a folder should be force-expanded if it (or any descendant) has matching items
    const folderHasMatch = (fId: string): boolean => {
      if (folderItems(fId).length > 0) return true;
      return childFolders(fId).some(k => folderHasMatch(k.id));
    };

    const renderFolderNode = (f: Folder, depth = 0): React.ReactNode => {
      const manuallyExpanded = expandedFolders[`${section}-${f.id}`];
      const autoExpand = searchActive && folderHasMatch(f.id);
      const isExpanded = manuallyExpanded || autoExpand;
      const kids = childFolders(f.id);
      const its = folderItems(f.id);
      if (kids.length === 0 && its.length === 0) return null;

      // Collect all descendant folder IDs (for delete-with-vars)
      const getDescendants = (rootId: string): Set<string> => {
        const ids = new Set([rootId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const ff of varFolders) {
            if (ff.parentId && ids.has(ff.parentId) && !ids.has(ff.id)) { ids.add(ff.id); changed = true; }
          }
        }
        return ids;
      };

      return (
        <React.Fragment key={f.id}>
          {/* Folder header row */}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: `5px 10px 5px ${10 + depth * 14}px`,
              cursor: 'pointer', userSelect: 'none',
            }}
            onClick={() => toggleFolder(`${section}-${f.id}`)}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1e293b'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <Chevron open={isExpanded} size={10} color="#6b7280" />
            <span style={{ fontSize: 11, fontWeight: 500, color: '#d1d5db', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            {section === 'var' && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setFolderMenu(m => m?.id === f.id ? null : { id: f.id, top: rect.bottom + 4, left: rect.right - 160 });
                }}
                style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 14, cursor: 'pointer', padding: '2px 4px', borderRadius: 3, lineHeight: 1, flexShrink: 0 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
              >⋮</button>
            )}
          </div>
          {/* Folder dot-menu portal */}
          {section === 'var' && folderMenu?.id === f.id && typeof document !== 'undefined' && ReactDOM.createPortal(
            <div
              ref={folderMenuRef}
              style={{ position: 'fixed', top: folderMenu.top, left: folderMenu.left, width: 160, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 99999, overflow: 'hidden' }}
            >
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => {
                  e.stopPropagation();
                  setFolderMenu(null);
                  const ids = getDescendants(f.id);
                  customVars.filter(v => v.folderId && ids.has(v.folderId)).forEach(v => removeCustomVar(v.name));
                  removeVarFolder(f.id);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 12, color: '#f87171', cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left' }}
              ><span>🗑</span> Remove with vars</button>
            </div>,
            document.body
          )}
          {isExpanded && (
            <>
              {its.map(i => renderItem(i, depth + 1))}
              {kids.map(k => renderFolderNode(k, depth + 1))}
            </>
          )}
        </React.Fragment>
      );
    };

    const hasAny = items.length > 0;
    return (
      <>
        {!hasAny && <div style={EMPTY}>{emptyMsg}</div>}
        {unfoldered.map(i => renderItem(i, 0))}
        {roots.map(f => renderFolderNode(f))}
      </>
    );
  }

  return (
    <div data-testid="data-tab-split" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Top: Data Sources ── */}
      <div data-testid="data-sources-column"
        style={{ flex: dsOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, borderBottom: '2px solid #1f2937', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}>
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setDsOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Chevron open={dsOpen} size={10} color="#6b7280" />
            Data Sources
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              title="Search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setDsSearchOpen(o => { const next = !o; if (next) setTimeout(() => dsSearchRef.current?.focus(), 20); else setDsSearch(''); return next; }); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: dsSearchOpen ? '#818cf8' : '#4b5563', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
              onMouseEnter={e => { if (!dsSearchOpen) (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
              onMouseLeave={e => { if (!dsSearchOpen) (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            {pageDataSources.length > 0 && (
              <button
                data-testid="remove-all-datasources-btn"
                title="Remove all data sources"
                onClick={() => { pageDataSources.forEach(d => removePageDataSource(d.id)); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                </svg>
              </button>
            )}
            <button data-testid="add-datasource-btn"
              onClick={() => onSetSlide({ kind: 'dataSource', editingId: null })}
              style={ADD_BTN}>
              + Add
            </button>
          </div>
        </div>
        {/* Slide-down search row */}
        <div style={{ overflow: 'hidden', maxHeight: dsSearchOpen ? 40 : 0, transition: 'max-height 0.2s ease', flexShrink: 0 }}>
          <div style={{ padding: '5px 10px' }}>
            <input
              ref={dsSearchRef}
              data-testid="ds-search"
              value={dsSearch}
              onChange={e => setDsSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setDsSearch(''); setDsSearchOpen(false); } }}
              placeholder="Search sources…"
              style={{ ...SEARCH_INPUT, width: '100%' }}
            />
          </div>
        </div>
        {dsOpen && (
          <>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {renderFolderGroup(
                filteredDs,
                (src, depth) => (
                  <DsRow
                    key={src.id}
                    src={src}
                    depth={depth}
                    isActive={activeDsId === src.id}
                    onEdit={() => { setActiveDsId(src.id); onWidthChange?.(src._lastFetch ? 660 : 320); onSetSlide({ kind: 'dataSource', editingId: src.id }); }}
                    onDelete={() => { if (activeDsId === src.id) setActiveDsId(null); removePageDataSource(src.id); }}
                    onDuplicate={() => { const newId = `ds-${Date.now()}`; addPageDataSource({ ...src, id: newId, name: src.name ? `${src.name}-copy` : undefined as unknown as string, storeIn: newId, _fromConfig: false }); }}
                    onMove={folderId => updatePageDataSource(src.id, { folderId })}
                  />
                ),
                'No data sources — config sources load automatically.',
                'ds',
                !!dsSearch
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Backend APIs — published only, folder view, loaded on mount ── */}
      {projectId && (
        <BackendApisSection
          projectId={projectId}
          onAdd={(wf, folderId) => {
            const id = `backend-${wf.id}`;
            if (pageDataSources.find(d => d.id === id)) return;
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
          }}
          onAddAll={(wfs, tables) => {
            // Create one ds-folder per table, then add each workflow into the right folder
            const folderIdMap: Record<string, string> = {};
            tables.forEach(t => {
              const folderId = `be-folder-${t.id}`;
              if (!dsFolders.find(f => f.id === folderId)) {
                addDsFolder({ id: folderId, name: t.displayName });
              }
              folderIdMap[t.id] = folderId;
            });
            wfs.forEach(wf => {
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
          }}
        />
      )}

      {/* ── Bottom: Variables ── */}
      <div data-testid="variables-column"
        style={{ flex: varOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}>
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setVarOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Chevron open={varOpen} size={10} color="#6b7280" />
            Variables
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              title="Search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setVarSearchOpen(o => { const next = !o; if (next) setTimeout(() => varSearchRef.current?.focus(), 20); else setVarSearch(''); return next; }); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: varSearchOpen ? '#818cf8' : '#4b5563', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
              onMouseEnter={e => { if (!varSearchOpen) (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
              onMouseLeave={e => { if (!varSearchOpen) (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            {customVars.length > 0 && (
              <button
                data-testid="remove-all-vars-btn"
                title="Remove all variables"
                onClick={() => { customVars.forEach(v => removeCustomVar(v.name)); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f87171'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                </svg>
              </button>
            )}
            <button data-testid="add-variable-btn"
              onClick={() => onSetSlide({ kind: 'variable', editingName: null })}
              style={ADD_BTN}>
              + Add
            </button>
          </div>
        </div>
        {/* Slide-down search row */}
        <div style={{ overflow: 'hidden', maxHeight: varSearchOpen ? 40 : 0, transition: 'max-height 0.2s ease', flexShrink: 0 }}>
          <div style={{ padding: '5px 10px' }}>
            <input
              ref={varSearchRef}
              data-testid="var-search"
              value={varSearch}
              onChange={e => setVarSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setVarSearch(''); setVarSearchOpen(false); } }}
              placeholder="Search variables…"
              style={{ ...SEARCH_INPUT, width: '100%' }}
            />
          </div>
        </div>
        {varOpen && (
          <>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {renderFolderGroup(
                filteredVars,
                (v, depth) => (
                  <VarRow
                    key={v.name}
                    v={v}
                    depth={depth}
                    onEdit={() => onSetSlide({ kind: 'variable', editingName: v.name })}
                    onDelete={() => removeCustomVar(v.name)}
                    onDuplicate={() => {
                      const base = v.name.replace(/_copy(\d*)$/, '');
                      const existing = customVars.map(c => c.name);
                      let candidate = `${base}_copy`;
                      let i = 2;
                      while (existing.includes(candidate)) candidate = `${base}_copy${i++}`;
                      addCustomVar({ ...v, name: candidate });
                    }}
                    onMove={folderId => updateCustomVar(v.name, { folderId })}
                  />
                ),
                'No variables yet — add one.',
                'var',
                !!varSearch
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── VarRow — variable list item with ⋮ context menu ─────────────────────────

function VarRow({
  v, depth = 0, onEdit, onDelete, onDuplicate, onMove,
}: {
  v: CustomVar;
  depth?: number;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (folderId: string | undefined) => void;
}) {
  const { varFolders: allFolders } = useBuilderStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const col = TYPE_BADGE_COLORS[v.type] ?? '#6b7280';

  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) { setMenuOpen(false); setShowMove(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
    setShowMove(false);
    setMenuOpen(o => !o);
  };

  const MENU_ITEM: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
    fontSize: 12, color: '#d1d5db', cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left',
  };

  const folderTree = (parentId: string | null, indent: number): React.ReactNode[] => {
    return allFolders.filter(f => (f.parentId ?? null) === parentId).flatMap(f => [
      <button
        key={f.id}
        data-testid={`var-menu-move-${v.name}-${f.id}`}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(f.id); }}
        style={{ ...MENU_ITEM, paddingLeft: 12 + indent * 12,
          fontWeight: v.folderId === f.id ? 700 : 400,
          color: v.folderId === f.id ? '#a5b4fc' : '#d1d5db' }}
      >
        {v.folderId === f.id && <span style={{ fontSize: 10 }}>✓</span>}
        {v.folderId !== f.id && <span style={{ fontSize: 10, opacity: 0 }}>✓</span>}
        {f.name}
      </button>,
      ...folderTree(f.id, indent + 1),
    ]);
  };

  return (
    <div
      data-testid={`var-row-${v.name}`}
      onClick={onEdit}
      style={{ paddingLeft: 10 + depth * 14, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: `${col}22`, color: col, border: `1px solid ${col}44`, flexShrink: 0, fontWeight: 600 }}>{v.type.slice(0, 3)}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.label ?? v.name}
        </span>
        {v.label && (
          <span style={{ display: 'block', fontSize: 9, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
            {v.name}
          </span>
        )}
      </span>

      {/* Dropdown menu (portal) */}
      {menuOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={menuRef}
          data-testid={`var-menu-${v.name}`}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 160, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 99999, overflow: 'hidden' }}
        >
          {!showMove ? (
            <>
              <button
                data-testid={`var-menu-copy-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); navigator.clipboard?.writeText(v.name); }}
                style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>⧉</span> Copy</button>
              <button
                data-testid={`var-menu-duplicate-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDuplicate(); }}
                style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>⧉</span> Duplicate</button>
              <button
                data-testid={`var-menu-move-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(true); }}
                style={{ ...MENU_ITEM, justifyContent: 'space-between' }}
              ><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>📁</span> Move to</span><Chevron open={false} size={10} color="#6b7280" /></button>
              <div style={{ borderTop: '1px solid #374151' }} />
              <button
                data-testid={`var-menu-delete-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                style={{ ...MENU_ITEM, color: '#f87171' }}
              ><span style={{ fontSize: 12 }}>🗑</span> Delete</button>
            </>
          ) : (
            <>
              {/* Back header */}
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(false); }}
                style={{ ...MENU_ITEM, color: '#9ca3af', gap: 6 }}
              ><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Chevron open={false} size={10} color="#9ca3af" style={{ transform: 'rotate(180deg)' }} /> Back</span></button>
              <div style={{ borderTop: '1px solid #374151' }} />
              {/* No folder option */}
              <button
                data-testid={`var-menu-move-${v.name}-none`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(undefined); }}
                style={{ ...MENU_ITEM, color: !v.folderId ? '#a5b4fc' : '#9ca3af', fontStyle: 'italic' }}
              >
                {!v.folderId ? <span style={{ fontSize: 10 }}>✓</span> : <span style={{ fontSize: 10, opacity: 0 }}>✓</span>}
                No folder
              </button>
              {allFolders.length > 0 && <div style={{ borderTop: '1px solid #374151' }} />}
              {/* Folder tree */}
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                {folderTree(null, 0)}
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── DsRow — redesigned list item with ⋮ context menu ────────────────────────

function DsRow({
  src, depth = 0, onEdit, onDelete, onDuplicate, onMove, isActive,
}: {
  src: DataSourceConfig;
  depth?: number;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (folderId: string | undefined) => void;
  isActive?: boolean;
}) {
  const { dsFolders: allFolders } = useBuilderStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const isConfig = !!(src as { _fromConfig?: boolean })._fromConfig;
  const isGraphQL = src.type === 'graphql';
  const typeColor = TYPE_COLOR[src.type] ?? '#6b7280';
  const srcDisplayKey = src.name || src.id;
  const lastFetch = src._lastFetch;
  const hasFetchData = !!lastFetch;
  const fetchDotColor = lastFetch?.status === 'success' ? '#34d399' : lastFetch?.status === 'error' ? '#f87171' : undefined;

  // Close on outside click
  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setShowMove(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 160 });
    setShowMove(false);
    setMenuOpen(o => !o);
  };

  const MENU_ITEM: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
    fontSize: 12, color: '#d1d5db', cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left',
  };

  const handleFetch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    window.dispatchEvent(new CustomEvent('sdui:refetch-datasource', { detail: { name: src.name || src.id } }));
  };

  const folderTree = (parentId: string | null, indent: number): React.ReactNode[] =>
    allFolders.filter(f => (f.parentId ?? null) === parentId).flatMap(f => [
      <button key={f.id}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(f.id); }}
        style={{ ...MENU_ITEM, paddingLeft: 12 + indent * 12,
          fontWeight: src.folderId === f.id ? 700 : 400,
          color: src.folderId === f.id ? '#a5b4fc' : '#d1d5db' }}
      >
        <span style={{ fontSize: 10 }}>{src.folderId === f.id ? '✓' : ' '}</span>{f.name}
      </button>,
      ...folderTree(f.id, indent + 1),
    ]);

  return (
    <div data-testid={`ds-card-${srcDisplayKey}`}
      onClick={onEdit}
      style={{ paddingLeft: 10 + depth * 14, paddingRight: 8, paddingTop: 5, paddingBottom: 5, borderBottom: '1px solid #0f172a', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: isActive ? '#1e293b' : 'transparent', borderLeft: isActive ? '2px solid #6366f1' : '2px solid transparent' }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 4, background: `${typeColor}18`, border: `1px solid ${typeColor}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: typeColor, fontWeight: 700 }}>
        {isGraphQL ? '⬡' : '⇄'}
      </span>
      <span data-testid={`ds-type-badge-${srcDisplayKey}`} style={{ display: 'none' }}>{src.type}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(src as { _label?: string })._label ?? src.name}
        </span>
        {(src as { _label?: string })._label && src.name && (
          <span style={{ display: 'block', fontSize: 9, color: '#4b5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
            {src.name}
          </span>
        )}
      </span>
      {hasFetchData && (
        <span title={lastFetch?.status === 'success' ? `Fetched ${lastFetch.fetchedAt ? new Date(lastFetch.fetchedAt).toLocaleTimeString() : ''}` : 'Last fetch failed'}
          style={{ width: 6, height: 6, borderRadius: '50%', background: fetchDotColor, flexShrink: 0, display: 'inline-block' }} />
      )}
      <button ref={btnRef} data-testid={`ds-menu-btn-${srcDisplayKey}`} onClick={openMenu}
        style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 14, cursor: 'pointer', padding: '2px 4px', borderRadius: 3, lineHeight: 1, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
      >⋮</button>

      {menuOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 160, background: '#1f2937', border: '1px solid #374151', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 99999, overflow: 'hidden' }}
        >
          {!showMove ? (
            <>
              {hasFetchData && (
                <button data-testid={`ds-menu-view-${srcDisplayKey}`}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}
                  style={MENU_ITEM}
                ><span style={{ fontSize: 11, color: fetchDotColor }}>●</span> View result</button>
              )}
              <button data-testid={`ds-menu-fetch-${srcDisplayKey}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={handleFetch} style={MENU_ITEM}
              ><span style={{ fontSize: 13 }}>↻</span> Fetch</button>
              <button data-testid={`edit-datasource-${src.id}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(); }} style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>✎</span> Edit</button>
              <button data-testid={`ds-menu-copy-${srcDisplayKey}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); navigator.clipboard?.writeText(srcDisplayKey); }} style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>⧉</span> Copy</button>
              <button data-testid={`ds-menu-duplicate-${srcDisplayKey}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDuplicate(); }} style={MENU_ITEM}
              ><span style={{ fontSize: 12 }}>⧉</span> Duplicate</button>
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(true); }}
                style={{ ...MENU_ITEM, justifyContent: 'space-between' }}
              ><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>📁</span> Move to</span><Chevron open={false} size={10} color="#6b7280" /></button>
              <div style={{ borderTop: '1px solid #374151' }} />
              <button data-testid={`delete-datasource-${src.id}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                style={{ ...MENU_ITEM, color: '#f87171' }}
              ><span style={{ fontSize: 12 }}>🗑</span> Delete</button>
            </>
          ) : (
            <>
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(false); }}
                style={{ ...MENU_ITEM, color: '#9ca3af', gap: 6 }}
              ><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Chevron open={false} size={10} color="#9ca3af" style={{ transform: 'rotate(180deg)' }} /> Back</span></button>
              <div style={{ borderTop: '1px solid #374151' }} />
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(undefined); }}
                style={{ ...MENU_ITEM, color: !src.folderId ? '#a5b4fc' : '#9ca3af', fontStyle: 'italic' }}
              >
                <span style={{ fontSize: 10 }}>{!src.folderId ? '✓' : ' '}</span> No folder
              </button>
              {allFolders.length > 0 && <div style={{ borderTop: '1px solid #374151' }} />}
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>{folderTree(null, 0)}</div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
