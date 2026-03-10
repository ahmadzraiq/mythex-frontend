'use client';

/**
 * Data Tab — left panel "Data" tab.
 *
 * Sections:
 *   A. Data Sources  — named REST/GraphQL sources with bind-button enabled form
 *   B. Variables     — named typed variables (CustomVars)
 */

import React, { useState, useCallback, useRef, lazy, Suspense } from 'react';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

const CodeMirror = lazy(() => import('@uiw/react-codemirror'));
import ReactDOM from 'react-dom';
import { useBuilderStore, type DataSourceConfig, type DataSourceParam, type CustomVar, type Folder, persistPreviewData } from './_store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL } from './_slide-panel';
// When a storeIn/id is a bare UUID, data lives under collections.UUID to match the
// {{collections.UUID.data.*}} path convention used in all screen/fragment configs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveStoreKey(key: string): string {
  return UUID_RE.test(key) ? `collections.${key}` : key;
}

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

// Width used when the result panel is open
const SLIDE_WITH_RESULT = 660;
// FORMULA_ANCHOR_LEFT and SLIDE_DEFAULT are imported from _data-source-form (used there too)

// ─── JsonTree — expandable JSON result viewer ─────────────────────────────────

function JsonNode({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);

  if (value === null) return <span style={{ color: '#9ca3af' }}>null</span>;
  if (value === undefined) return <span style={{ color: '#9ca3af' }}>undefined</span>;
  if (typeof value === 'boolean') return <span style={{ color: '#fb923c' }}>{String(value)}</span>;
  if (typeof value === 'number') return <span style={{ color: '#34d399' }}>{value}</span>;
  if (typeof value === 'string') return <span style={{ color: '#f9a8d4' }}>"{value}"</span>;

  const isArr = Array.isArray(value);
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) return <span style={{ color: '#6b7280' }}>{isArr ? '[]' : '{}'}</span>;

  const INDENT = 14;
  const openBrace = isArr ? '[' : '{';
  const closeBrace = isArr ? ']' : '}';
  const previewCount = Math.min(entries.length, 3);
  const preview = entries.slice(0, previewCount).map(([k]) => isArr ? '' : k).filter(Boolean).join(', ');

  return (
    <span>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '0 2px', fontSize: 10, lineHeight: 1, verticalAlign: 'middle' }}
      >
        {open ? '▾' : '▸'}
      </button>
      {!open && (
        <span style={{ color: '#6b7280', fontSize: 10 }}>
          {openBrace}{preview && !isArr ? <span style={{ color: '#9ca3af' }}> {preview}… </span> : <span style={{ color: '#9ca3af' }}> {entries.length} items </span>}{closeBrace}
        </span>
      )}
      {open && (
        <span>
          <span style={{ color: '#6b7280' }}>{openBrace}</span>
          <div style={{ marginLeft: INDENT }}>
            {entries.map(([k, v], i) => (
              <div key={k} style={{ lineHeight: '1.7', fontSize: 11 }}>
                {!isArr && <span style={{ color: '#93c5fd' }}>{k}</span>}
                {!isArr && <span style={{ color: '#6b7280' }}>: </span>}
                <JsonNode value={v} depth={depth + 1} />
                {i < entries.length - 1 && <span style={{ color: '#4b5563' }}>,</span>}
              </div>
            ))}
          </div>
          <span style={{ color: '#6b7280' }}>{closeBrace}</span>
        </span>
      )}
    </span>
  );
}

interface FetchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: unknown;
  error?: string;
}

function FetchResultPanel({ result }: { result: FetchState }) {
  const isSuccess = result.status === 'success';
  return (
    <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid #1f2937', display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>Result</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          background: isSuccess ? '#064e3b' : '#7f1d1d',
          color: isSuccess ? '#34d399' : '#f87171',
        }}>
          {isSuccess ? 'Success' : 'Error'}
        </span>
      </div>
      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, color: '#f3f4f6' }}>
        {result.status === 'error'
          ? <span style={{ color: '#f87171' }}>{result.error}</span>
          : <JsonNode value={result.data} depth={0} />
        }
      </div>
    </div>
  );
}

// ─── Formula resolution helpers ───────────────────────────────────────────────

/** Extract a nested value by a dot-separated path (e.g. "data.search.items"). */
function extractByPath(data: unknown, path: string): unknown {
  if (!path) return data;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, data);
}

/** Build the current context from Zustand + variable store (same as FormulaEditor). */
// buildContext and resolveEntryValue moved to _data-source-form.tsx (shared with RestForm/GraphQLForm)


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
    return <VariableSlideContent initial={existing} onSave={handleVarSave} onClose={onClose} />;
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

interface DataTabProps {
  onSetSlide: (s: DataTabSlideState) => void;
  onWidthChange?: (w: number) => void;
}

export function DataTab({ onSetSlide, onWidthChange }: DataTabProps) {
  const [dsSearch, setDsSearch] = useState('');
  const [varSearch, setVarSearch] = useState('');
  const [dsSearchOpen, setDsSearchOpen] = useState(false);
  const [varSearchOpen, setVarSearchOpen] = useState(false);
  const dsSearchRef = useRef<HTMLInputElement>(null);
  const varSearchRef = useRef<HTMLInputElement>(null);
  const [dsOpen, setDsOpen] = useState(true);
  const [varOpen, setVarOpen] = useState(true);
  const [activeDsId, setActiveDsId] = useState<string | null>(null);
  const { pageDataSources, removePageDataSource, addPageDataSource, updatePageDataSource, customVars, removeCustomVar, addCustomVar, updateCustomVar, varFolders, dsFolders } = useBuilderStore();
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const toggleFolder = (id: string) => setExpandedFolders(s => ({ ...s, [id]: !s[id] }));

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
          </div>
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

      {/* ⋮ menu button */}
      <button
        ref={btnRef}
        data-testid={`var-menu-btn-${v.name}`}
        onClick={openMenu}
        style={{ background: 'none', border: 'none', color: '#4b5563', fontSize: 14, cursor: 'pointer', padding: '2px 4px', borderRadius: 3, lineHeight: 1, flexShrink: 0 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4b5563'; }}
      >⋮</button>

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
