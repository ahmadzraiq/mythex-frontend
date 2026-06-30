'use client';

/**
 * Data Tab — left panel "Data" tab.
 *
 * Sections:
 *   A. Data Sources  — named REST/GraphQL sources with bind-button enabled form
 *   B. Variables     — named typed variables (CustomVars)
 */

import React, { useState, useCallback, useRef, lazy, Suspense, useEffect } from 'react';
import { SearchInput } from './_panel-primitives';
import { useSearchParams, useLocation } from 'react-router-dom';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

const CodeMirror = lazy(() => import('@uiw/react-codemirror'));
import ReactDOM from 'react-dom';
import { useBuilderStore, type DataSourceConfig, type DataSourceParam, type CustomVar, type Folder, persistPreviewData } from './_store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL } from './_slide-panel';
import { IcoEdit, IcoCopy, IcoDuplicate, IcoTrash, IcoFolder, IcoRefresh } from './_icons';
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
  width: '100%', background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4,
  padding: '4px 8px', fontSize: 10, color: 'var(--bld-text-2)', outline: 'none', boxSizing: 'border-box',
};

const SUB_HDR: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: 'var(--bld-text-disabled)', textTransform: 'none' as const, padding: '4px 12px 2px', background: 'var(--bld-bg-base)',
};

const METHOD_COLOR: Record<string, string> = {
  GET: 'var(--bld-success)', POST: 'var(--bld-info)', PUT: 'var(--bld-warning)', PATCH: 'var(--bld-accent)', DELETE: 'var(--bld-error)',
};
const METHOD_BG: Record<string, string> = {
  GET: 'rgba(34,197,94,0.12)', POST: 'rgba(59,130,246,0.12)', PUT: 'rgba(245,158,11,0.12)',
  PATCH: 'rgba(139,92,246,0.12)', DELETE: 'rgba(239,68,68,0.12)',
};

interface DataTabProps {
  onSetSlide: (s: DataTabSlideState) => void;
  onWidthChange?: (w: number) => void;
  /** When true the tab renders at natural height inside a scrollable parent. */
  merged?: boolean;
}

export function DataTab({ onSetSlide, onWidthChange, merged = false }: DataTabProps) {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
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
  const { pageDataSources, removePageDataSource, addPageDataSource, updatePageDataSource, customVars, removeCustomVar, addCustomVar, updateCustomVar, varFolders, dsFolders, removeVarFolder } = useBuilderStore();

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
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <Chevron open={isExpanded} size={10} color="var(--bld-text-disabled)" />
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--bld-text-disabled)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--bld-text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
            {section === 'var' && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setFolderMenu(m => m?.id === f.id ? null : { id: f.id, top: rect.bottom + 4, left: rect.right - 160 });
                }}
                style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', fontSize: 14, cursor: 'pointer', padding: '2px 4px', borderRadius: 3, lineHeight: 1, flexShrink: 0 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
              >⋮</button>
            )}
          </div>
          {/* Folder dot-menu portal */}
          {section === 'var' && folderMenu?.id === f.id && typeof document !== 'undefined' && ReactDOM.createPortal(
            <div
              ref={folderMenuRef}
              style={{ position: 'fixed', top: folderMenu.top, left: folderMenu.left, width: 160, background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 99999, overflow: 'hidden' }}
            >
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => {
                  e.stopPropagation();
                  setFolderMenu(null);
                  const ids = getDescendants(f.id);
                  customVars.filter(v => v.folderId && ids.has(v.folderId)).forEach(v => removeCustomVar(v.name));
                  removeVarFolder(f.id);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 12, color: 'var(--bld-error)', cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left' }}
              ><IcoTrash /> Remove with vars</button>
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
    <div data-testid="data-tab-split" style={merged
      ? { flexShrink: 0, display: 'flex', flexDirection: 'column' }
      : { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Top: Data Sources ── */}
      <div data-testid="data-sources-column"
        style={merged
          ? { display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: dsOpen ? 600 : 38, transition: 'max-height 0.22s ease' }
          : { flex: dsOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, borderBottom: '0.5px solid var(--bld-bg-input)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}>
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setDsOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Chevron open={dsOpen} size={10} color="var(--bld-text-disabled)" />
            Data Sources
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              title="Search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setDsSearchOpen(o => { const next = !o; if (next) setTimeout(() => dsSearchRef.current?.focus(), 20); else setDsSearch(''); return next; }); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: dsSearchOpen ? 'var(--bld-accent)' : 'var(--bld-text-disabled)', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
              onMouseEnter={e => { if (!dsSearchOpen) (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
              onMouseLeave={e => { if (!dsSearchOpen) (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
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
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-error)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                </svg>
              </button>
            )}
            <button
              data-testid="add-datasource-btn"
              title="New data source"
              onClick={() => onSetSlide({ kind: 'dataSource', editingId: null })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 10, fontWeight: 500, padding: '2px 4px', borderRadius: 3 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-accent)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
            >New</button>
          </div>
        </div>
        {/* Slide-down search row */}
        <div style={{ overflow: 'hidden', maxHeight: dsSearchOpen ? 40 : 0, transition: 'max-height 0.2s ease', flexShrink: 0 }}>
          <div style={{ padding: '5px 10px' }}>
            <SearchInput
              value={dsSearch}
              onChange={setDsSearch}
              placeholder="Search sources…"
              inputRef={dsSearchRef}
              data-testid="ds-search"
              onKeyDown={e => { if (e.key === 'Escape') { setDsSearch(''); setDsSearchOpen(false); } }}
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
      {merged && <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent 0%, var(--bld-border-subtle) 20%, var(--bld-border-subtle) 80%, transparent 100%)', flexShrink: 0 }} />}

      {/* ── Variables ── */}
      <div data-testid="variables-column"
        style={merged
          ? { display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: varOpen ? 600 : 38, transition: 'max-height 0.22s ease' }
          : { flex: varOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}>
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setVarOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Chevron open={varOpen} size={10} color="var(--bld-text-disabled)" />
            Variables
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button
              title="Search"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { setVarSearchOpen(o => { const next = !o; if (next) setTimeout(() => varSearchRef.current?.focus(), 20); else setVarSearch(''); return next; }); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: varSearchOpen ? 'var(--bld-accent)' : 'var(--bld-text-disabled)', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
              onMouseEnter={e => { if (!varSearchOpen) (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
              onMouseLeave={e => { if (!varSearchOpen) (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
              {customVars.length > 0 && (
              <button
                data-testid="remove-all-vars-btn"
                title="Remove all variables"
                onClick={() => {
                  customVars.forEach(v => removeCustomVar(v.name));
                  varFolders.forEach(f => removeVarFolder(f.id));
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', padding: '2px 3px', display: 'flex', alignItems: 'center', borderRadius: 3 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-error)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                </svg>
              </button>
            )}
            <button
              data-testid="add-variable-btn"
              title="New variable"
              onClick={() => onSetSlide({ kind: 'variable', editingName: null })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 10, fontWeight: 500, padding: '2px 4px', borderRadius: 3 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-accent)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
            >New</button>
          </div>
        </div>
        {/* Slide-down search row */}
        <div style={{ overflow: 'hidden', maxHeight: varSearchOpen ? 40 : 0, transition: 'max-height 0.2s ease', flexShrink: 0 }}>
          <div style={{ padding: '5px 10px' }}>
            <SearchInput
              value={varSearch}
              onChange={setVarSearch}
              placeholder="Search variables…"
              inputRef={varSearchRef}
              data-testid="var-search"
              onKeyDown={e => { if (e.key === 'Escape') { setVarSearch(''); setVarSearchOpen(false); } }}
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
      {merged && <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent 0%, var(--bld-border-subtle) 20%, var(--bld-border-subtle) 80%, transparent 100%)', flexShrink: 0 }} />}
    </div>
  );
}


// ─── VarRow — variable list item with ⋮ context menu ─────────────────────────

// Readable type labels for variable badges
const VAR_TYPE_LABEL: Record<string, string> = {
  string: 'str', number: 'num', boolean: 'bool',
  array: 'arr', object: 'obj', color: 'color',
  date: 'date', any: 'any',
};

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
  const col = TYPE_BADGE_COLORS[v.type] ?? 'var(--bld-text-disabled)';
  const typeLabel = VAR_TYPE_LABEL[v.type] ?? v.type.slice(0, 4);

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
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 168 });
    setShowMove(false);
    setMenuOpen(o => !o);
  };

  const MENU_ITEM: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
    fontSize: 11, color: 'var(--bld-text-2)', cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left' as const,
  };

  const folderTree = (parentId: string | null, indent: number): React.ReactNode[] =>
    allFolders.filter(f => (f.parentId ?? null) === parentId).flatMap(f => [
      <button
        key={f.id}
        data-testid={`var-menu-move-${v.name}-${f.id}`}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(f.id); }}
        style={{ ...MENU_ITEM, paddingLeft: 12 + indent * 12, fontWeight: v.folderId === f.id ? 700 : 400, color: v.folderId === f.id ? 'var(--bld-accent)' : 'var(--bld-text-2)' }}
      >
        {v.folderId === f.id
          ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          : <span style={{ width: 10, display: 'inline-block' }} />
        }
        {f.name}
      </button>,
      ...folderTree(f.id, indent + 1),
    ]);

  return (
    <div
      data-testid={`var-row-${v.name}`}
      onClick={onEdit}
      style={{
        paddingLeft: 10 + depth * 14, paddingRight: 6, paddingTop: 6, paddingBottom: 6,
        borderBottom: '1px solid var(--bld-bg-base)',
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {/* Type chip — readable label, colored */}
      <span style={{
        fontSize: 8, padding: '2px 5px', borderRadius: 3,
        background: `${col}1a`, color: col, border: `1px solid ${col}33`,
        flexShrink: 0, fontWeight: 700,
        minWidth: typeLabel.length >= 4 ? 30 : 22, textAlign: 'center',
      }}>{typeLabel}</span>

      {/* Name */}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--bld-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.label ?? v.name}
        </span>
      </span>

      {/* ⋮ menu button */}
      <button
        ref={btnRef}
        onClick={openMenu}
        style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', fontSize: 14, cursor: 'pointer', padding: '2px 4px', borderRadius: 3, lineHeight: 1, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
      >⋮</button>

      {menuOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={menuRef}
          data-testid={`var-menu-${v.name}`}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 168, background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 7, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', zIndex: 99999, overflow: 'hidden', padding: '3px 0' }}
        >
          {!showMove ? (
            <>
              <button
                data-testid={`var-menu-copy-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); navigator.clipboard?.writeText(v.name); }}
                style={MENU_ITEM}
              ><IcoCopy /> Copy name</button>
              <button
                data-testid={`var-menu-duplicate-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDuplicate(); }}
                style={MENU_ITEM}
              ><IcoDuplicate /> Duplicate</button>
              <button
                data-testid={`var-menu-move-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(true); }}
                style={{ ...MENU_ITEM, justifyContent: 'space-between' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IcoFolder /> Move to folder</span>
                <Chevron open={false} size={9} color="var(--bld-text-disabled)" />
              </button>
              <div style={{ margin: '3px 0', borderTop: 'none' }} />
              <button
                data-testid={`var-menu-delete-${v.name}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                style={{ ...MENU_ITEM, color: 'var(--bld-error)' }}
              ><IcoTrash /> Delete</button>
            </>
          ) : (
            <>
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(false); }}
                style={{ ...MENU_ITEM, color: 'var(--bld-text-3)' }}
              ><Chevron open={false} size={9} color="var(--bld-text-3)" style={{ transform: 'rotate(180deg)' }} /> Back</button>
              <div style={{ margin: '3px 0', borderTop: 'none' }} />
              <button
                data-testid={`var-menu-move-${v.name}-none`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(undefined); }}
                style={{ ...MENU_ITEM, color: !v.folderId ? 'var(--bld-accent)' : 'var(--bld-text-3)' }}
              >
                {!v.folderId
                  ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <span style={{ width: 10, display: 'inline-block' }} />
                }
                No folder
              </button>
              {allFolders.length > 0 && <div style={{ margin: '3px 0', borderTop: 'none' }} />}
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>{folderTree(null, 0)}</div>
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

  const isGraphQL = src.type === 'graphql';
  const method = (src.method ?? 'GET').toUpperCase();
  const srcDisplayKey = src.name || src.id;
  const displayName = (src as { _label?: string })._label ?? src.name ?? src.id;
  const subName = (src as { _label?: string })._label && src.name ? src.name : null;
  const lastFetch = src._lastFetch;
  const hasFetchData = !!lastFetch;
  const fetchOk = lastFetch?.status === 'success';
  const fetchErr = lastFetch?.status === 'error';
  const isAuto = src.trigger === 'mount' || (src.trigger as string) === 'auto';
  const isConfig = !!(src as { _fromConfig?: boolean })._fromConfig;

  const methodColor = isGraphQL ? 'var(--bld-accent)' : (METHOD_COLOR[method] ?? 'var(--bld-text-3)');
  const methodBg = isGraphQL ? 'rgba(139,92,246,0.12)' : (METHOD_BG[method] ?? 'rgba(148,163,184,0.1)');
  const methodLabel = isGraphQL ? 'GQL' : method;

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
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 168 });
    setShowMove(false);
    setMenuOpen(o => !o);
  };

  const handleFetch = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    window.dispatchEvent(new CustomEvent('sdui:refetch-datasource', { detail: { name: src.name || src.id } }));
  };

  const MENU_ITEM: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
    fontSize: 11, color: 'var(--bld-text-2)', cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left' as const,
  };

  const folderTree = (parentId: string | null, indent: number): React.ReactNode[] =>
    allFolders.filter(f => (f.parentId ?? null) === parentId).flatMap(f => [
      <button key={f.id}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(f.id); }}
        style={{ ...MENU_ITEM, paddingLeft: 12 + indent * 12, fontWeight: src.folderId === f.id ? 700 : 400, color: src.folderId === f.id ? 'var(--bld-accent)' : 'var(--bld-text-2)' }}
      >
        {src.folderId === f.id
          ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          : <span style={{ width: 10, display: 'inline-block' }} />
        }
        {f.name}
      </button>,
      ...folderTree(f.id, indent + 1),
    ]);

  return (
    <div
      data-testid={`ds-card-${srcDisplayKey}`}
      onClick={onEdit}
      style={{
        paddingLeft: 10 + depth * 14, paddingRight: 6, paddingTop: 6, paddingBottom: 6,
        borderBottom: '1px solid var(--bld-bg-base)',
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        background: isActive ? 'var(--bld-bg-active)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--bld-accent)' : '2px solid transparent',
      }}
      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {/* Method badge */}
      <span
        data-testid={`ds-type-badge-${srcDisplayKey}`}
        title={isGraphQL ? 'GraphQL' : `${method} request`}
        style={{
          flexShrink: 0, fontSize: 8, fontWeight: 700,
          padding: '2px 4px', borderRadius: 3,
          background: methodBg, color: methodColor,
          minWidth: isGraphQL ? 26 : method.length <= 3 ? 22 : 32,
          textAlign: 'center',
        }}
      >{methodLabel}</span>

      {/* Name */}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--bld-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName}
        </span>
      </span>

      {/* Indicators */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        {isAuto && (
          <span title="Auto-fetches on load" style={{ fontSize: 9, color: 'var(--bld-info)', lineHeight: 1 }}>⚡</span>
        )}
        {hasFetchData && (
          <span
            title={fetchOk ? `Fetched${lastFetch?.fetchedAt ? ' ' + new Date(lastFetch.fetchedAt).toLocaleTimeString() : ''}` : 'Last fetch failed'}
            style={{ width: 5, height: 5, borderRadius: '50%', background: fetchOk ? 'var(--bld-success)' : fetchErr ? 'var(--bld-error)' : 'var(--bld-text-disabled)', display: 'inline-block' }}
          />
        )}
      </span>

      {/* ⋮ menu button */}
      <button
        ref={btnRef}
        data-testid={`ds-menu-btn-${srcDisplayKey}`}
        onClick={openMenu}
        style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', fontSize: 14, cursor: 'pointer', padding: '2px 4px', borderRadius: 3, lineHeight: 1, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)'; }}
      >⋮</button>

      {menuOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 168, background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 7, boxShadow: '0 6px 20px rgba(0,0,0,0.5)', zIndex: 99999, overflow: 'hidden', padding: '3px 0' }}
        >
          {!showMove ? (
            <>
              {hasFetchData && (
                <button data-testid={`ds-menu-view-${srcDisplayKey}`}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}
                  style={MENU_ITEM}
                >
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: fetchOk ? 'var(--bld-success)' : 'var(--bld-error)', display: 'inline-block', flexShrink: 0 }} />
                  View result
                </button>
              )}
              <button data-testid={`ds-menu-fetch-${srcDisplayKey}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={handleFetch} style={MENU_ITEM}
              ><IcoRefresh /> Fetch now</button>
              <button data-testid={`edit-datasource-${src.id}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onEdit(); }} style={MENU_ITEM}
              ><IcoEdit /> Edit</button>
              <button data-testid={`ds-menu-copy-${srcDisplayKey}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); navigator.clipboard?.writeText(srcDisplayKey); }} style={MENU_ITEM}
              ><IcoCopy /> Copy name</button>
              <button data-testid={`ds-menu-duplicate-${srcDisplayKey}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDuplicate(); }} style={MENU_ITEM}
              ><IcoDuplicate /> Duplicate</button>
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(true); }}
                style={{ ...MENU_ITEM, justifyContent: 'space-between' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><IcoFolder /> Move to folder</span>
                <Chevron open={false} size={9} color="var(--bld-text-disabled)" />
              </button>
              <div style={{ margin: '3px 0', borderTop: 'none' }} />
              <button data-testid={`delete-datasource-${src.id}`}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                style={{ ...MENU_ITEM, color: 'var(--bld-error)' }}
              ><IcoTrash /> Delete</button>
            </>
          ) : (
            <>
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setShowMove(false); }}
                style={{ ...MENU_ITEM, color: 'var(--bld-text-3)' }}
              ><Chevron open={false} size={9} color="var(--bld-text-3)" style={{ transform: 'rotate(180deg)' }} /> Back</button>
              <div style={{ margin: '3px 0', borderTop: 'none' }} />
              <button
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
                onClick={e => { e.stopPropagation(); setMenuOpen(false); setShowMove(false); onMove(undefined); }}
                style={{ ...MENU_ITEM, color: !src.folderId ? 'var(--bld-accent)' : 'var(--bld-text-3)' }}
              >
                {!src.folderId
                  ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <span style={{ width: 10, display: 'inline-block' }} />
                }
                No folder
              </button>
              {allFolders.length > 0 && <div style={{ margin: '3px 0', borderTop: 'none' }} />}
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>{folderTree(null, 0)}</div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
