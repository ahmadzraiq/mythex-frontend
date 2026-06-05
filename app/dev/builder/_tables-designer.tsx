'use client';
/**
 * Tables Designer — WeWeb-style live data grid.
 *
 * Left sidebar : table list + search + Add Table
 * Main area    : tab bar (Data | View tabs | + New view)
 *                toolbar (Insert | Columns | Filter | Sort | Pagination | Refresh)
 *                spreadsheet data grid with inline edit
 *                footer (row count + pagination)
 *
 * Modals / panels:
 *   Settings button → floating card (Name + Description + Delete)
 *   View ⋮          → floating card (View name + Description + Delete view)
 *   Grid header +   → right-side AddColumnPanel (full WeWeb form)
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  backendTables, backendViews, backendRows,
  type BackendTable, type BackendColumn, type BackendView,
  type RowsListOptions,
} from '@/lib/platform/api-client';
import {
  type FilterCondition, type FilterGroup, type SortSpec,
  FilterPanel, SortPanel, Toggle, PanelFooter, uid,
} from './_filter-sort-panels';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivePanel = 'insert' | 'parameters' | 'columns' | 'filter' | 'sort' | 'pagination' | null;

interface ViewParameter {
  id: string;
  name: string;
  type: string;
  defaultValue: string;
}

const PAGE_SIZE_OPTIONS = [0, 20, 50, 100, 1000] as const;

const COLUMN_TYPES = [
  'TEXT', 'INT', 'BIGINT', 'DECIMAL', 'BOOL', 'JSON', 'UUID',
  'TIMESTAMP', 'DATE', 'FILE', 'ENUM', 'MONEY', 'VECTOR', 'RELATION',
] as const;

const TYPE_ICON: Record<string, string> = {
  UUID: '⚷', TEXT: 'T', INT: '#', BIGINT: '#', DECIMAL: '#',
  BOOL: '⊟', JSON: '{}', TIMESTAMP: '⎗', DATE: '⎗',
  FILE: '⎘', ENUM: '≡', MONEY: '$', VECTOR: '∿', RELATION: '↔',
};

function typeIcon(type: string) { return TYPE_ICON[type] ?? 'T'; }
function formatCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// ─── Style constants ──────────────────────────────────────────────────────────

const BTN: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '4px 10px', fontSize: 12, fontWeight: 500,
  background: 'transparent', color: '#94a3b8',
  border: '1px solid transparent', borderRadius: 5,
  cursor: 'pointer', whiteSpace: 'nowrap',
};
const BTN_ACTIVE: React.CSSProperties = {
  ...BTN, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
  border: '1px solid rgba(99,102,241,0.3)',
};
const BTN_PRIMARY: React.CSSProperties = {
  ...BTN, background: '#4f46e5', color: '#fff',
  border: '1px solid #4f46e5', fontWeight: 600,
};
const INPUT_STYLE: React.CSSProperties = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
  padding: '8px 12px', fontSize: 13, color: '#e2e8f0', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};
const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE, cursor: 'pointer' };
const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute', zIndex: 50,
  background: '#0f172a', border: '1px solid #1e293b',
  borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  minWidth: 280,
};

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
}

export function TablesDesigner({ projectId, selectedTableId, onSelectTable }: Props) {
  const [tables, setTables]           = useState<BackendTable[]>([]);
  const [tableSearch, setTableSearch] = useState('');
  const [loadingTables, setLoadingTables] = useState(true);

  // data grid
  const [rows, setRows]             = useState<Record<string, unknown>[]>([]);
  const [totalRows, setTotalRows]   = useState(0);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState<number>(20);
  const [loadingRows, setLoadingRows] = useState(false);

  // views
  const [views, setViews]           = useState<BackendView[]>([]);
  const [activeView, setActiveView] = useState<'data' | string>('data');
  const [showNewView, setShowNewView] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  // toolbar panels
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  // columns visibility
  const [visibleCols, setVisibleCols]     = useState<string[]>([]);
  const [pendingVisibleCols, setPendingVisibleCols] = useState<string[]>([]);

  // filters
  const [filters, setFilters]             = useState<FilterCondition[]>([]);
  const [filterGroups, setFilterGroups]   = useState<FilterGroup[]>([]);
  const [pendingFilters, setPendingFilters]         = useState<FilterCondition[]>([]);
  const [pendingFilterGroups, setPendingFilterGroups] = useState<FilterGroup[]>([]);

  // sorts
  const [sorts, setSorts]           = useState<SortSpec[]>([]);
  const [pendingSorts, setPendingSorts] = useState<SortSpec[]>([]);

  const [pendingPageSize, setPendingPageSize] = useState<number>(20);

  // insert row
  const [insertRowValues, setInsertRowValues] = useState<Record<string, string>>({});
  const [insertingRow, setInsertingRow] = useState(false);

  // inline edit
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // ── settings modal (table)
  const [showSettings, setShowSettings]   = useState(false);
  const [settingName, setSettingName]     = useState('');
  const [settingDesc, setSettingDesc]     = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // ── view settings modal
  const [viewSettingsId, setViewSettingsId] = useState<string | null>(null);
  const [viewSettingName, setViewSettingName] = useState('');
  const [viewSettingDesc, setViewSettingDesc] = useState('');
  const [savingViewSettings, setSavingViewSettings] = useState(false);

  // ── add column panel (right side)
  const [showAddColPanel, setShowAddColPanel] = useState(false);
  const [newCol, setNewCol] = useState<Partial<BackendColumn>>({ type: 'TEXT', nullable: true });
  const [savingCol, setSavingCol] = useState(false);

  // ── view parameters (definition per viewId + runtime values)
  const [viewParamsMap, setViewParamsMap] = useState<Record<string, ViewParameter[]>>({});
  const [pendingParams, setPendingParams] = useState<ViewParameter[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // add table
  const [showAddTable, setShowAddTable] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [creatingTable, setCreatingTable] = useState(false);

  // import ERD
  const [showErdModal, setShowErdModal] = useState(false);

  const [error, setError] = useState('');

  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null;

  const allCols = (() => {
    if (!selectedTable) return [];
    const userCols = selectedTable.columns.map((c) => c.name);
    const userHas = (n: string) => userCols.includes(n);
    // If the user explicitly defined id/created_at/updated_at (e.g. via ERD), respect their order.
    // Otherwise prepend id and append created_at/updated_at as system columns.
    const base: string[] = [];
    if (!userHas('id')) base.push('id');
    base.push(...userCols);
    if (!userHas('created_at')) base.push('created_at');
    if (!userHas('updated_at')) base.push('updated_at');
    return base;
  })();

  const colMeta = (name: string): Partial<BackendColumn> => {
    if (name === 'id') return { name: 'id', type: 'UUID' };
    if (name === 'created_at') return { name: 'created_at', type: 'TIMESTAMP' };
    if (name === 'updated_at') return { name: 'updated_at', type: 'TIMESTAMP' };
    return selectedTable?.columns.find((c) => c.name === name) ?? { name, type: 'TEXT' };
  };

  // ── Load tables ────────────────────────────────────────────────────────────
  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    try {
      const res = await backendTables.list(projectId);
      setTables(res.tables);
      if (!selectedTableId && res.tables.length > 0) onSelectTable(res.tables[0].id);
    } catch (e) { setError((e as Error).message); }
    finally { setLoadingTables(false); }
  }, [projectId, selectedTableId, onSelectTable]);

  useEffect(() => { void loadTables(); }, [loadTables]);

  // ── Load views when table changes ─────────────────────────────────────────
  useEffect(() => {
    if (!selectedTableId) return;
    setActiveView('data');
    backendViews.list(projectId)
      .then((r) => setViews(r.views.filter((v) => v.tableId === selectedTableId)))
      .catch(() => void 0);
  }, [projectId, selectedTableId]);

  // ── Sync settings when table changes ──────────────────────────────────────
  useEffect(() => {
    if (selectedTable) {
      setSettingName(selectedTable.displayName ?? selectedTable.name);
      setSettingDesc((selectedTable as unknown as { description?: string }).description ?? '');
      const cols = ['id', 'created_at', 'updated_at', ...selectedTable.columns.map((c) => c.name)];
      setVisibleCols(cols);
      setPendingVisibleCols(cols);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTable?.id]);

  // ── Load rows ──────────────────────────────────────────────────────────────
  const loadRows = useCallback(async () => {
    if (!selectedTable) return;
    setLoadingRows(true);
    try {
      const activeViewObj = views.find((v) => v.id === activeView);
      // Resolve parameter values into filter conditions for the active view
      const activeParams = activeView !== 'data' ? (viewParamsMap[activeView] ?? []) : [];
      const paramFilters: RowsListOptions['filters'] = activeParams
        .filter((p) => paramValues[p.id] !== undefined && paramValues[p.id] !== '')
        .map((p) => ({ field: p.name, operator: 'Is', value: paramValues[p.id] }));

      const mergedFilters = [
        ...((activeViewObj?.filters as RowsListOptions['filters']) ?? []),
        ...filters.filter((f) => f.active).map((f) => ({ field: f.field, operator: f.operator, value: f.value })),
        ...(paramFilters ?? []),
      ];
      const mergedSorts = [
        ...sorts,
        ...((activeViewObj?.sort as RowsListOptions['sort']) ?? []),
      ];
      const opts: RowsListOptions = {
        filters: mergedFilters, sort: mergedSorts,
        page, pageSize: pageSize === 0 ? undefined : pageSize,
      };
      const res = await backendRows.list(projectId, selectedTable.name, opts);
      setRows(res.data ?? []);
      setTotalRows(res.total ?? 0);
    } catch (e) { setError((e as Error).message); }
    finally { setLoadingRows(false); }
  }, [projectId, selectedTable, activeView, views, filters, sorts, page, pageSize]);

  useEffect(() => { if (selectedTable) void loadRows(); }, [loadRows]);

  const displayCols = allCols.filter((c) => visibleCols.includes(c));

  // ── Panel toggle ───────────────────────────────────────────────────────────
  const togglePanel = (p: ActivePanel) => {
    if (activePanel === p) { setActivePanel(null); return; }
    if (p === 'columns') setPendingVisibleCols([...visibleCols]);
    if (p === 'filter') { setPendingFilters([...filters]); setPendingFilterGroups([...filterGroups]); }
    if (p === 'sort') setPendingSorts([...sorts]);
    if (p === 'pagination') setPendingPageSize(pageSize);
    if (p === 'parameters' && activeView !== 'data') {
      setPendingParams([...(viewParamsMap[activeView] ?? [])]);
    }
    setActivePanel(p);
    setShowSettings(false);
    setViewSettingsId(null);
  };

  const closeAllOverlays = () => {
    setActivePanel(null);
    setShowSettings(false);
    setViewSettingsId(null);
  };

  // ── Insert row ─────────────────────────────────────────────────────────────
  const handleInsertRow = async () => {
    if (!selectedTable) return;
    setInsertingRow(true);
    try {
      const payload: Record<string, unknown> = {};
      selectedTable.columns.forEach((c) => {
        if (insertRowValues[c.name] !== undefined && insertRowValues[c.name] !== '')
          payload[c.name] = insertRowValues[c.name];
      });
      await backendRows.insert(projectId, selectedTable.name, payload);
      setInsertRowValues({});
      setActivePanel(null);
      await loadRows();
    } catch (e) { setError((e as Error).message); }
    finally { setInsertingRow(false); }
  };

  // ── Cell edit ──────────────────────────────────────────────────────────────
  const commitEdit = async () => {
    if (!editingCell || !selectedTable) return;
    try {
      await backendRows.update(projectId, selectedTable.name, editingCell.rowId, {
        [editingCell.col]: editingValue,
      });
      setRows((prev) => prev.map((r) =>
        String(r.id) === editingCell.rowId ? { ...r, [editingCell.col]: editingValue } : r,
      ));
    } catch (e) { setError((e as Error).message); }
    finally { setEditingCell(null); }
  };

  const deleteRow = async (rowId: string) => {
    if (!selectedTable || !confirm('Delete this row?')) return;
    try {
      await backendRows.delete(projectId, selectedTable.name, rowId);
      setRows((prev) => prev.filter((r) => String(r.id) !== rowId));
      setTotalRows((n) => n - 1);
    } catch (e) { setError((e as Error).message); }
  };

  // ── Table CRUD ─────────────────────────────────────────────────────────────
  const createTable = async () => {
    if (!newTableName.trim()) return;
    setCreatingTable(true);
    try {
      const res = await backendTables.create(projectId, {
        name: newTableName.trim().toLowerCase().replace(/\s+/g, '_'),
        displayName: newTableName.trim(), createApiActions: true,
      });
      setTables((prev) => [...prev, res.table]);
      onSelectTable(res.table.id);
      setNewTableName('');
      setShowAddTable(false);
    } catch (e) { setError((e as Error).message); }
    finally { setCreatingTable(false); }
  };

  const handleErdImported = useCallback(async (firstTableId?: string) => {
    // Reload the full table list so each table has .columns populated
    try {
      const res = await backendTables.list(projectId);
      setTables(res.tables);
      if (firstTableId) onSelectTable(firstTableId);
      else if (res.tables.length > 0) onSelectTable(res.tables[0].id);
    } catch { /* ignore */ }
    setShowErdModal(false);
  }, [projectId, onSelectTable]);

  const saveTableSettings = async () => {
    if (!selectedTableId) return;
    setSavingSettings(true);
    try {
      const res = await backendTables.update(projectId, selectedTableId, { displayName: settingName });
      setTables((prev) => prev.map((t) => t.id === selectedTableId ? res.table : t));
    } catch (e) { setError((e as Error).message); }
    finally { setSavingSettings(false); }
  };

  const deleteTable = async () => {
    if (!selectedTableId || !confirm('Delete this table and ALL its data? This cannot be undone.')) return;
    try {
      await backendTables.delete(projectId, selectedTableId);
      setTables((prev) => prev.filter((t) => t.id !== selectedTableId));
      onSelectTable(null);
      setShowSettings(false);
    } catch (e) { setError((e as Error).message); }
  };

  const deleteAllTables = async () => {
    if (!confirm('Delete ALL tables and their data? This cannot be undone.')) return;
    try {
      await backendTables.deleteAll(projectId);
      setTables([]);
      onSelectTable(null);
      setShowSettings(false);
    } catch (e) { setError((e as Error).message); }
  };

  // ── View CRUD ──────────────────────────────────────────────────────────────
  const createView = async () => {
    if (!selectedTableId || !newViewName.trim()) return;
    try {
      const slug = newViewName.trim().toLowerCase().replace(/\s+/g, '-');
      const res = await backendViews.create(projectId, {
        tableId: selectedTableId, name: newViewName.trim(), slug, security: 'PUBLIC',
      });
      setViews((prev) => [...prev, res.view]);
      setActiveView(res.view.id);
      setNewViewName('');
      setShowNewView(false);
    } catch (e) { setError((e as Error).message); }
  };

  const saveViewSettings = async () => {
    if (!viewSettingsId) return;
    setSavingViewSettings(true);
    try {
      const res = await backendViews.update(projectId, viewSettingsId, { name: viewSettingName });
      setViews((prev) => prev.map((v) => v.id === viewSettingsId ? res.view : v));
      setViewSettingsId(null);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingViewSettings(false); }
  };

  const deleteView = async (viewId: string) => {
    if (!confirm('Delete this view?')) return;
    try {
      await backendViews.delete(projectId, viewId);
      setViews((prev) => prev.filter((v) => v.id !== viewId));
      if (activeView === viewId) setActiveView('data');
      setViewSettingsId(null);
    } catch (e) { setError((e as Error).message); }
  };

  // ── Add column ─────────────────────────────────────────────────────────────
  const addColumn = async () => {
    if (!selectedTableId || !newCol.name) return;
    setSavingCol(true);
    try {
      const res = await backendTables.addColumn(projectId, selectedTableId, newCol);
      setTables((prev) => prev.map((t) =>
        t.id === selectedTableId ? { ...t, columns: [...t.columns, res.column] } : t,
      ));
      setVisibleCols((prev) => [...prev, res.column.name]);
      setPendingVisibleCols((prev) => [...prev, res.column.name]);
      setNewCol({ type: 'TEXT', nullable: true });
      setShowAddColPanel(false);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingCol(false); }
  };

  const filteredTables = tables.filter((t) =>
    t.displayName.toLowerCase().includes(tableSearch.toLowerCase()) ||
    t.name.toLowerCase().includes(tableSearch.toLowerCase()),
  );

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* Backdrop — closes any open overlay on outside click */}
      {(activePanel || showSettings || viewSettingsId) && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 40 }}
          onClick={closeAllOverlays}
        />
      )}

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <Sidebar
        tables={filteredTables}
        tableSearch={tableSearch}
        onSearchChange={setTableSearch}
        selectedTableId={selectedTableId}
        onSelectTable={(id) => { onSelectTable(id); setActivePanel(null); setShowSettings(false); setViewSettingsId(null); }}
        loadingTables={loadingTables}
        showAddTable={showAddTable}
        onToggleAddTable={() => setShowAddTable((v) => !v)}
        newTableName={newTableName}
        onNewTableNameChange={setNewTableName}
        onCreateTable={() => void createTable()}
        creatingTable={creatingTable}
        onCancelAddTable={() => { setShowAddTable(false); setNewTableName(''); }}
        onImportErd={() => setShowErdModal(true)}
        onDeleteAll={() => void deleteAllTables()}
      />
      {showErdModal && (
        <ImportErdModal
          projectId={projectId}
          onImported={handleErdImported}
          onClose={() => setShowErdModal(false)}
        />
      )}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {!selectedTable && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13 }}>
            Select a table from the sidebar to view its data.
          </div>
        )}

        {selectedTable && (
          <>
            {/* Breadcrumb + Settings */}
            <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #1e293b', flexShrink: 0, position: 'relative', zIndex: 41 }}>
              <span style={{ fontSize: 13, color: '#475569' }}>⊞</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{selectedTable.displayName}</span>
              <div style={{ flex: 1 }} />
              <button
                onClick={(e) => { e.stopPropagation(); setShowSettings((v) => !v); setActivePanel(null); setViewSettingsId(null); }}
                style={showSettings ? BTN_ACTIVE : BTN}
              >
                ⚙ Settings
              </button>

              {/* Settings floating modal */}
              {showSettings && (
                <div style={{ ...PANEL_STYLE, top: '100%', right: 0, width: 340, zIndex: 60 }} onClick={(e) => e.stopPropagation()}>
                  <SettingsCard
                    name={settingName}
                    desc={settingDesc}
                    onNameChange={setSettingName}
                    onDescChange={setSettingDesc}
                    onSave={() => void saveTableSettings()}
                    saving={savingSettings}
                    onDelete={() => void deleteTable()}
                  />
                </div>
              )}
            </div>

            {/* View tabs */}
            <ViewTabBar
              views={views}
              activeView={activeView}
              onSelectView={(v) => { setActiveView(v); setPage(1); closeAllOverlays(); }}
              showNewView={showNewView}
              onToggleNewView={() => setShowNewView((v) => !v)}
              newViewName={newViewName}
              onNewViewNameChange={setNewViewName}
              onCreateView={() => void createView()}
              onCancelNewView={() => { setShowNewView(false); setNewViewName(''); }}
              viewSettingsId={viewSettingsId}
              onViewSettings={(id, name, desc) => {
                setViewSettingsId(id);
                setViewSettingName(name);
                setViewSettingDesc(desc);
                setShowSettings(false);
                setActivePanel(null);
              }}
              onCloseViewSettings={() => setViewSettingsId(null)}
              viewSettingName={viewSettingName}
              viewSettingDesc={viewSettingDesc}
              onViewSettingNameChange={setViewSettingName}
              onViewSettingDescChange={setViewSettingDesc}
              onSaveViewSettings={() => void saveViewSettings()}
              savingViewSettings={savingViewSettings}
              onDeleteView={(id) => void deleteView(id)}
            />

            {/* Toolbar */}
            <Toolbar
              activePanel={activePanel}
              isDataTab={activeView === 'data'}
              onTogglePanel={(p) => { togglePanel(p); }}
              onRefresh={() => void loadRows()}
              hasActiveFilters={filters.filter((f) => f.active).length > 0}
              hasActiveSorts={sorts.length > 0}
            />

            {/* Runtime param value bar — shown when the active view has defined parameters */}
            {activeView !== 'data' && (viewParamsMap[activeView] ?? []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '8px 16px', borderBottom: '1px solid #1e293b', background: '#080d17' }}>
                {(viewParamsMap[activeView] ?? []).map((p) => (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.name}</span>
                    <input
                      value={paramValues[p.id] ?? p.defaultValue}
                      onChange={(e) => setParamValues((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="Enter a value"
                      style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: '#e2e8f0', outline: 'none', width: 160 }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Panel popovers (toolbar panels) */}
            <div style={{ position: 'relative', zIndex: 41 }}>
              {activePanel === 'insert' && activeView === 'data' && (
                <InsertPanel
                  table={selectedTable}
                  insertRowValues={insertRowValues}
                  onChangeValues={setInsertRowValues}
                  onInsertRow={() => void handleInsertRow()}
                  onInsertColumn={() => { setActivePanel(null); setShowAddColPanel(true); }}
                  inserting={insertingRow}
                  onClose={() => setActivePanel(null)}
                />
              )}
              {activePanel === 'parameters' && activeView !== 'data' && (
                <ParametersPanel
                  pending={pendingParams}
                  onChange={setPendingParams}
                  onReset={() => setPendingParams([...(viewParamsMap[activeView] ?? [])])}
                  onSave={() => {
                    setViewParamsMap((prev) => ({ ...prev, [activeView]: pendingParams }));
                    // reset runtime values for removed params
                    const keepIds = new Set(pendingParams.map((p) => p.id));
                    setParamValues((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => keepIds.has(k))));
                    setActivePanel(null);
                  }}
                />
              )}
              {activePanel === 'columns' && (
                <ColumnsPanel
                  allCols={allCols}
                  pending={pendingVisibleCols}
                  onChange={setPendingVisibleCols}
                  colMeta={colMeta}
                  onReset={() => setPendingVisibleCols(allCols)}
                  onSave={() => { setVisibleCols(pendingVisibleCols); setActivePanel(null); }}
                />
              )}
              {activePanel === 'filter' && (
                <FilterPanel
                  conditions={pendingFilters}
                  groups={pendingFilterGroups}
                  allCols={allCols}
                  onChange={setPendingFilters}
                  onChangeGroups={setPendingFilterGroups}
                  onReset={() => { setPendingFilters([]); setPendingFilterGroups([]); }}
                  onSave={() => { setFilters(pendingFilters); setFilterGroups(pendingFilterGroups); setPage(1); setActivePanel(null); }}
                />
              )}
              {activePanel === 'sort' && (
                <SortPanel
                  pending={pendingSorts}
                  allCols={allCols}
                  onChange={setPendingSorts}
                  onReset={() => setPendingSorts([])}
                  onSave={() => { setSorts(pendingSorts); setPage(1); setActivePanel(null); }}
                />
              )}
              {activePanel === 'pagination' && (
                <PaginationPanel
                  pending={pendingPageSize}
                  onChange={setPendingPageSize}
                  onSave={() => { setPageSize(pendingPageSize); setPage(1); setActivePanel(null); }}
                />
              )}
            </div>

            {/* Data grid */}
            <DataGrid
              rows={rows}
              displayCols={displayCols}
              colMeta={colMeta}
              loading={loadingRows}
              editingCell={editingCell}
              editingValue={editingValue}
              isDataTab={activeView === 'data'}
              onStartEdit={(rowId, col, val) => {
                if (col === 'id' || col === 'created_at' || col === 'updated_at') return;
                setEditingCell({ rowId, col });
                setEditingValue(String(val ?? ''));
              }}
              onEditValue={setEditingValue}
              onCommitEdit={() => void commitEdit()}
              onCancelEdit={() => setEditingCell(null)}
              onDeleteRow={(id) => void deleteRow(id)}
              onAddColumn={() => { setShowAddColPanel(true); closeAllOverlays(); }}
            />

            {/* Footer */}
            <GridFooter
              totalRows={totalRows}
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </div>

      {/* ── Add Column Panel (right-side drawer) ──────────────────────────── */}
      {showAddColPanel && selectedTable && (
        <AddColumnPanel
          col={newCol}
          onChange={setNewCol}
          onSave={() => void addColumn()}
          onCancel={() => { setShowAddColPanel(false); setNewCol({ type: 'TEXT', nullable: true }); }}
          saving={savingCol}
        />
      )}

      {/* Error toast */}
      {error && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#7f1d1d', color: '#fca5a5', padding: '8px 16px', borderRadius: 6,
          fontSize: 12, zIndex: 200, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ─── Settings card (shared by table + view) ───────────────────────────────────

function SettingsCard({
  name, desc, onNameChange, onDescChange, onSave, saving, onDelete,
}: {
  name: string;
  desc: string;
  onNameChange: (v: string) => void;
  onDescChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  onDelete: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Name */}
      <div style={{ padding: '16px 16px 12px' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
          Name <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={onSave}
          style={INPUT_STYLE}
        />
      </div>

      {/* Description */}
      <div style={{ padding: '0 16px 14px' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
          Description
        </label>
        <RichTextArea value={desc} onChange={onDescChange} />
      </div>

      {/* Divider + Delete */}
      <div style={{ borderTop: '1px solid #1e293b', padding: '12px 16px' }}>
        <button
          onClick={onDelete}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

// ─── Rich text area (toolbar + textarea) ──────────────────────────────────────

const RICH_TOOLBAR = [
  { icon: 'T', title: 'Text' }, { icon: 'B', title: 'Bold' }, { icon: 'I', title: 'Italic' },
  { icon: 'S̶', title: 'Strike' }, { icon: '🔗', title: 'Link' }, { icon: '≡', title: 'Bullet list' },
  { icon: '1.', title: 'Ordered list' }, { icon: '""', title: 'Quote' }, { icon: '<>', title: 'Code' },
  { icon: '⎖', title: 'Image' }, { icon: '▶', title: 'Video' },
];

function RichTextArea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ border: '1px solid #334155', borderRadius: 6, overflow: 'hidden', background: '#1e293b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '5px 8px', borderBottom: '1px solid #334155', flexWrap: 'wrap' }}>
        {RICH_TOOLBAR.map((t) => (
          <button
            key={t.title}
            title={t.title}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 11, padding: '2px 5px', borderRadius: 3 }}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=""
        rows={5}
        style={{
          width: '100%', background: 'transparent', border: 'none', outline: 'none',
          color: '#e2e8f0', fontSize: 13, padding: '10px 12px', resize: 'none',
          boxSizing: 'border-box', lineHeight: '1.5',
        }}
      />
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  tables, tableSearch, onSearchChange, selectedTableId, onSelectTable,
  loadingTables, showAddTable, onToggleAddTable, newTableName, onNewTableNameChange,
  onCreateTable, creatingTable, onCancelAddTable, onImportErd, onDeleteAll,
}: {
  tables: BackendTable[];
  tableSearch: string;
  onSearchChange: (v: string) => void;
  selectedTableId: string | null;
  onSelectTable: (id: string) => void;
  loadingTables: boolean;
  showAddTable: boolean;
  onToggleAddTable: () => void;
  newTableName: string;
  onNewTableNameChange: (v: string) => void;
  onCreateTable: () => void;
  creatingTable: boolean;
  onCancelAddTable: () => void;
  onImportErd: () => void;
  onDeleteAll: () => void;
}) {
  const sideInputStyle: React.CSSProperties = {
    background: '#111827', border: '1px solid #374151', borderRadius: 4,
    padding: '4px 8px', fontSize: 11, color: '#e2e8f0', outline: 'none',
    width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={{ width: 220, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', background: '#080d17', flexShrink: 0 }}>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Tables</span>
        <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={onImportErd}
            title="Import from ERD (dbdiagram.io)"
            style={{ ...BTN, border: '1px solid #374151', padding: '3px 8px', fontSize: 11, color: '#94a3b8' }}
          >⬆ ERD</button>
          <button onClick={onToggleAddTable} style={{ ...BTN_PRIMARY, padding: '3px 9px', fontSize: 11 }}>+ Add</button>
        </div>
      </div>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1e293b' }}>
        <input value={tableSearch} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search tables" style={sideInputStyle} />
      </div>
      {showAddTable && (
        <div style={{ padding: 10, borderBottom: '1px solid #1e293b', background: 'rgba(79,70,229,0.05)' }}>
          <input
            autoFocus value={newTableName} onChange={(e) => onNewTableNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onCreateTable(); if (e.key === 'Escape') onCancelAddTable(); }}
            placeholder="Table name" style={sideInputStyle}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            <button onClick={onCreateTable} disabled={creatingTable || !newTableName.trim()} style={{ ...BTN_PRIMARY, flex: 1, justifyContent: 'center', opacity: creatingTable ? 0.6 : 1, fontSize: 11 }}>
              {creatingTable ? '…' : 'Create'}
            </button>
            <button onClick={onCancelAddTable} style={{ ...BTN, border: '1px solid #374151', fontSize: 11 }}>✕</button>
          </div>
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loadingTables && <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: '#475569' }}>Loading…</div>}
        {!loadingTables && tables.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: '#475569' }}>No tables yet.<br />Click + Add Table.</div>
        )}
        {tables.map((t) => {
          const active = t.id === selectedTableId;
          return (
            <div key={t.id} onClick={() => onSelectTable(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', cursor: 'pointer',
              background: active ? 'rgba(79,70,229,0.12)' : 'transparent',
              borderLeft: `2px solid ${active ? '#6366f1' : 'transparent'}`,
            }}>
              <span style={{ fontSize: 12, color: active ? '#818cf8' : '#475569' }}>⊞</span>
              <span style={{ flex: 1, fontSize: 12, color: active ? '#e2e8f0' : '#94a3b8', fontWeight: active ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.displayName}
              </span>
              <span style={{ fontSize: 10, color: '#334155' }}>{t.columns.length + 3}</span>
            </div>
          );
        })}
      </div>
      {tables.length > 0 && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid #1e293b' }}>
          <button
            onClick={onDeleteAll}
            style={{ width: '100%', padding: '5px 0', fontSize: 11, background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 5, cursor: 'pointer' }}
          >
            🗑 Remove All Tables
          </button>
        </div>
      )}
    </div>
  );
}

// ─── View tab bar ─────────────────────────────────────────────────────────────

function ViewTabBar({
  views, activeView, onSelectView, showNewView, onToggleNewView,
  newViewName, onNewViewNameChange, onCreateView, onCancelNewView,
  viewSettingsId, onViewSettings, onCloseViewSettings,
  viewSettingName, viewSettingDesc, onViewSettingNameChange, onViewSettingDescChange,
  onSaveViewSettings, savingViewSettings, onDeleteView,
}: {
  views: BackendView[];
  activeView: 'data' | string;
  onSelectView: (v: 'data' | string) => void;
  showNewView: boolean;
  onToggleNewView: () => void;
  newViewName: string;
  onNewViewNameChange: (v: string) => void;
  onCreateView: () => void;
  onCancelNewView: () => void;
  viewSettingsId: string | null;
  onViewSettings: (id: string, name: string, desc: string) => void;
  onCloseViewSettings: () => void;
  viewSettingName: string;
  viewSettingDesc: string;
  onViewSettingNameChange: (v: string) => void;
  onViewSettingDescChange: (v: string) => void;
  onSaveViewSettings: () => void;
  savingViewSettings: boolean;
  onDeleteView: (id: string) => void;
}) {
  const tabBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px',
    fontSize: 12, cursor: 'pointer', background: 'transparent', border: 'none',
    borderBottom: '2px solid transparent', color: '#94a3b8', whiteSpace: 'nowrap',
  };
  const tabActive: React.CSSProperties = {
    ...tabBase, color: '#e2e8f0', borderBottom: '2px solid #6366f1', fontWeight: 600,
  };

  const sideInput: React.CSSProperties = {
    background: '#111827', border: '1px solid #374151', borderRadius: 4,
    padding: '3px 7px', fontSize: 11, color: '#e2e8f0', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #1e293b', flexShrink: 0, overflow: 'visible', position: 'relative', zIndex: 41 }}>
      <button style={activeView === 'data' ? tabActive : tabBase} onClick={() => onSelectView('data')}>
        <span style={{ fontSize: 11 }}>⊞</span> Data
      </button>

      {views.map((v) => (
        <div key={v.id} style={{ position: 'relative', display: 'inline-flex', alignItems: 'stretch' }}>
          <button style={activeView === v.id ? tabActive : tabBase} onClick={() => onSelectView(v.id)}>
            <span style={{ fontSize: 11 }}>⊙</span> {v.name}
          </button>
          {/* ⋮ dots */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (viewSettingsId === v.id) { onCloseViewSettings(); return; }
              onViewSettings(v.id, v.name, '');
            }}
            style={{ ...BTN, padding: '4px 6px', fontSize: 13, color: '#475569', borderBottom: activeView === v.id ? '2px solid #6366f1' : '2px solid transparent' }}
          >
            ⋮
          </button>

          {/* View settings floating card */}
          {viewSettingsId === v.id && (
            <div
              style={{ ...PANEL_STYLE, top: '100%', left: 0, width: 340, zIndex: 60 }}
              onClick={(e) => e.stopPropagation()}
            >
              <SettingsCard
                name={viewSettingName}
                desc={viewSettingDesc}
                onNameChange={onViewSettingNameChange}
                onDescChange={onViewSettingDescChange}
                onSave={onSaveViewSettings}
                saving={savingViewSettings}
                onDelete={() => onDeleteView(v.id)}
              />
            </div>
          )}
        </div>
      ))}

      {/* New view */}
      {showNewView ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px' }}>
          <input
            autoFocus value={newViewName} onChange={(e) => onNewViewNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onCreateView(); if (e.key === 'Escape') onCancelNewView(); }}
            placeholder="View name" style={{ ...sideInput, width: 120 }}
          />
          <button onClick={onCreateView} style={{ ...BTN_PRIMARY, padding: '3px 9px', fontSize: 11 }}>+</button>
          <button onClick={onCancelNewView} style={{ ...BTN, border: '1px solid #374151', padding: '3px 6px', fontSize: 11 }}>✕</button>
        </div>
      ) : (
        <button style={{ ...tabBase, color: '#6366f1' }} onClick={onToggleNewView}>
          + New view
        </button>
      )}
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({
  activePanel, isDataTab, onTogglePanel, onRefresh, hasActiveFilters, hasActiveSorts,
}: {
  activePanel: ActivePanel;
  isDataTab: boolean;
  onTogglePanel: (p: ActivePanel) => void;
  onRefresh: () => void;
  hasActiveFilters: boolean;
  hasActiveSorts: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderBottom: '1px solid #1e293b', flexShrink: 0, background: '#080d17' }}>
      {isDataTab
        ? <button style={activePanel === 'insert' ? BTN_ACTIVE : BTN_PRIMARY} onClick={() => onTogglePanel('insert')}>+ Insert</button>
        : <button style={(activePanel as string) === 'parameters' ? BTN_ACTIVE : { ...BTN, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6 }} onClick={() => onTogglePanel('parameters')}>⊕ Parameters</button>
      }
      <div style={{ width: 1, height: 16, background: '#1e293b', margin: '0 4px' }} />
      <button style={activePanel === 'columns' ? BTN_ACTIVE : BTN} onClick={() => onTogglePanel('columns')}>⊞ Columns</button>
      <button style={activePanel === 'filter' ? BTN_ACTIVE : (hasActiveFilters ? { ...BTN, color: '#818cf8' } : BTN)} onClick={() => onTogglePanel('filter')}>
        ⫠ Filter{hasActiveFilters && <span style={{ fontSize: 10, background: '#4f46e5', color: '#fff', borderRadius: 9, padding: '1px 5px', marginLeft: 3 }}>ON</span>}
      </button>
      <button style={activePanel === 'sort' ? BTN_ACTIVE : (hasActiveSorts ? { ...BTN, color: '#818cf8' } : BTN)} onClick={() => onTogglePanel('sort')}>
        ↕ Sort{hasActiveSorts && <span style={{ fontSize: 10, background: '#4f46e5', color: '#fff', borderRadius: 9, padding: '1px 5px', marginLeft: 3 }}>ON</span>}
      </button>
      <button style={activePanel === 'pagination' ? BTN_ACTIVE : BTN} onClick={() => onTogglePanel('pagination')}>⎘ Pagination</button>
      <div style={{ flex: 1 }} />
      <button style={BTN} onClick={onRefresh}>↺ Refresh</button>
    </div>
  );
}

// ─── Insert panel ─────────────────────────────────────────────────────────────

function InsertPanel({
  table, insertRowValues, onChangeValues, onInsertRow, onInsertColumn, inserting, onClose,
}: {
  table: BackendTable;
  insertRowValues: Record<string, string>;
  onChangeValues: (v: Record<string, string>) => void;
  onInsertRow: () => void;
  onInsertColumn: () => void;
  inserting: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'row'>('menu');

  if (mode === 'menu') {
    return (
      <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 260 }}>
        <MenuItem icon="☰" title="Insert a row" subtitle={`Insert a new row into ${table.displayName}`} onClick={() => setMode('row')} />
        <MenuItem icon="⊞" title="Insert a column" subtitle={`Insert a new column into ${table.displayName}`} onClick={onInsertColumn} />
      </div>
    );
  }

  return (
    <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 300, maxHeight: 420, overflow: 'auto' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Insert a row</span>
        <button onClick={() => setMode('menu')} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 11 }}>← Back</button>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {table.columns.map((col) => (
          <div key={col.id}>
            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, display: 'block', marginBottom: 3 }}>
              {typeIcon(col.type)} {col.displayName ?? col.name}
              {col.required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
            </label>
            <input
              style={{ ...INPUT_STYLE, fontSize: 12, padding: '4px 8px' }}
              value={insertRowValues[col.name] ?? ''}
              placeholder={col.type === 'BOOL' ? 'true / false' : col.type}
              onChange={(e) => onChangeValues({ ...insertRowValues, [col.name]: e.target.value })}
            />
          </div>
        ))}
        {table.columns.length === 0 && <p style={{ fontSize: 12, color: '#475569' }}>No custom columns. Add columns via the + button.</p>}
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid #1e293b', display: 'flex', gap: 8 }}>
        <button onClick={onInsertRow} disabled={inserting} style={{ ...BTN_PRIMARY, flex: 1, justifyContent: 'center', opacity: inserting ? 0.6 : 1 }}>
          {inserting ? 'Inserting…' : 'Insert row'}
        </button>
        <button onClick={onClose} style={{ ...BTN, border: '1px solid #374151' }}>Cancel</button>
      </div>
    </div>
  );
}

function MenuItem({ icon, title, subtitle, onClick }: { icon: string; title: string; subtitle: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', cursor: 'pointer', background: hover ? 'rgba(99,102,241,0.08)' : 'transparent' }}>
      <div style={{ width: 28, height: 28, background: '#1e293b', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#818cf8', flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );
}

// ─── Columns panel ────────────────────────────────────────────────────────────

function ColumnsPanel({ allCols, pending, onChange, colMeta, onReset, onSave }: {
  allCols: string[];
  pending: string[];
  onChange: (v: string[]) => void;
  colMeta: (name: string) => Partial<BackendColumn>;
  onReset: () => void;
  onSave: () => void;
}) {
  const toggle = (col: string) =>
    onChange(pending.includes(col) ? pending.filter((c) => c !== col) : [...pending, col]);

  return (
    <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 260 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #1e293b' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Columns</span>
      </div>
      <div style={{ padding: '6px 0', maxHeight: 280, overflow: 'auto' }}>
        {allCols.map((col) => {
          const meta = colMeta(col);
          const on = pending.includes(col);
          return (
            <div key={col} onClick={() => toggle(col)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', cursor: 'pointer' }}>
              <Toggle on={on} />
              <span style={{ fontSize: 12, color: '#475569', width: 16, textAlign: 'center', flexShrink: 0 }}>{typeIcon(meta.type ?? 'TEXT')}</span>
              <span style={{ fontSize: 12, color: '#e2e8f0' }}>{col}</span>
            </div>
          );
        })}
      </div>
      <PanelFooter onReset={onReset} onSave={onSave} />
    </div>
  );
}

// ─── Filter panel ─────────────────────────────────────────────────────────────

// FilterPanel, SortPanel, Toggle are imported from _filter-sort-panels.tsx

// ─── Pagination panel ─────────────────────────────────────────────────────────

function PaginationPanel({ pending, onChange, onSave }: { pending: number; onChange: (v: number) => void; onSave: () => void }) {
  return (
    <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 320 }}>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>Rows per page <span style={{ color: '#ef4444' }}>*</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PAGE_SIZE_OPTIONS.map((opt) => (
            <button key={opt} onClick={() => onChange(opt)} style={{
              padding: '5px 14px', fontSize: 12, borderRadius: 20, cursor: 'pointer',
              background: pending === opt ? 'rgba(99,102,241,0.2)' : 'transparent',
              border: `1px solid ${pending === opt ? '#6366f1' : '#374151'}`,
              color: pending === opt ? '#a5b4fc' : '#94a3b8',
              fontWeight: pending === opt ? 600 : 400,
            }}>
              {opt === 0 ? 'Unlimited' : opt}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: '8px 14px', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onSave} style={{ ...BTN_PRIMARY, padding: '5px 16px' }}>Save</button>
      </div>
    </div>
  );
}

// ─── Parameters panel ─────────────────────────────────────────────────────────

const PARAM_TYPES = ['TEXT', 'INT', 'DECIMAL', 'BOOL', 'DATE', 'TIMESTAMP', 'UUID'] as const;

function ParametersPanel({ pending, onChange, onReset, onSave }: {
  pending: ViewParameter[];
  onChange: (v: ViewParameter[]) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const addParam = () =>
    onChange([...pending, { id: uid(), name: '', type: 'TEXT', defaultValue: '' }]);

  const update = (id: string, patch: Partial<ViewParameter>) =>
    onChange(pending.map((p) => p.id === id ? { ...p, ...patch } : p));

  const s: React.CSSProperties = {
    background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
    padding: '6px 10px', fontSize: 12, color: '#e2e8f0', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 600 }}>
      {pending.length > 0 && (
        <>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 32px', gap: 8, padding: '10px 16px 4px', borderBottom: '1px solid #1e293b' }}>
            {['Parameter name', 'Parameter type', 'Default value', ''].map((h) => (
              <span key={h} style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>{h}</span>
            ))}
          </div>
          {/* Rows */}
          <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map((p) => (
              <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 32px', gap: 8, alignItems: 'center' }}>
                <input
                  value={p.name}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                  placeholder="Parameter name"
                  style={{ ...s, width: '100%' }}
                />
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#94a3b8', pointerEvents: 'none' }}>
                    {typeIcon(p.type)}
                  </span>
                  <select
                    value={p.type}
                    onChange={(e) => update(p.id, { type: e.target.value })}
                    style={{ ...s, width: '100%', paddingLeft: 28 }}
                  >
                    {PARAM_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
                  </select>
                </div>
                <input
                  value={p.defaultValue}
                  onChange={(e) => update(p.id, { defaultValue: e.target.value })}
                  placeholder="Parameter value"
                  style={{ ...s, width: '100%' }}
                />
                <button
                  onClick={() => onChange(pending.filter((x) => x.id !== p.id))}
                  style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16, padding: 0 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ padding: pending.length > 0 ? '4px 16px 10px' : '10px 16px' }}>
        <button onClick={addParam} style={{ ...BTN, fontSize: 12, color: '#94a3b8', padding: '4px 0' }}>
          + Add Parameters
        </button>
      </div>
      <PanelFooter onReset={onReset} onSave={onSave} />
    </div>
  );
}

// ─── Data grid ────────────────────────────────────────────────────────────────

function DataGrid({
  rows, displayCols, colMeta, loading,
  editingCell, editingValue, isDataTab,
  onStartEdit, onEditValue, onCommitEdit, onCancelEdit, onDeleteRow, onAddColumn,
}: {
  rows: Record<string, unknown>[];
  displayCols: string[];
  colMeta: (name: string) => Partial<BackendColumn>;
  loading: boolean;
  editingCell: { rowId: string; col: string } | null;
  editingValue: string;
  isDataTab: boolean;
  onStartEdit: (rowId: string, col: string, val: unknown) => void;
  onEditValue: (v: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDeleteRow: (id: string) => void;
  onAddColumn: () => void;
}) {
  const COL_WIDTH = 180;

  return (
    <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,13,23,0.7)', zIndex: 10 }}>
          <span style={{ fontSize: 13, color: '#475569' }}>Loading…</span>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: '#0a0f1a', position: 'sticky', top: 0, zIndex: 5 }}>
            <th style={{ width: 36, borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b', padding: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 34 }}>
                <input type="checkbox" style={{ accentColor: '#6366f1' }} />
              </div>
            </th>
            {displayCols.map((col) => {
              const meta = colMeta(col);
              const system = col === 'id' || col === 'created_at' || col === 'updated_at';
              return (
                <th key={col} style={{ width: COL_WIDTH, borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b', padding: 0, textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 34 }}>
                    <span style={{ fontSize: 12, color: '#475569', flexShrink: 0 }}>{typeIcon(meta.type ?? 'TEXT')}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: system ? '#94a3b8' : '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col}</span>
                    <span style={{ fontSize: 11, color: '#334155', cursor: 'pointer', flexShrink: 0 }}>⋮</span>
                  </div>
                </th>
              );
            })}
            {/* + add column — only on Data tab */}
            {isDataTab && (
              <th style={{ width: 40, borderBottom: '1px solid #1e293b', padding: 0 }}>
                <button onClick={onAddColumn} style={{ width: '100%', height: 34, background: 'none', border: 'none', cursor: 'pointer', color: '#334155', fontSize: 16 }} title="Add column">+</button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={displayCols.length + 2} style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#475569' }}>
                No rows yet. Click Insert → Insert a row.
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const rowId = String(row.id ?? '');
            return (
              <DataRow key={rowId} row={row} rowId={rowId} displayCols={displayCols}
                editingCell={editingCell} editingValue={editingValue}
                onStartEdit={onStartEdit} onEditValue={onEditValue}
                onCommitEdit={onCommitEdit} onCancelEdit={onCancelEdit} onDeleteRow={onDeleteRow}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataRow({
  row, rowId, displayCols, editingCell, editingValue,
  onStartEdit, onEditValue, onCommitEdit, onCancelEdit, onDeleteRow,
}: {
  row: Record<string, unknown>; rowId: string; displayCols: string[];
  editingCell: { rowId: string; col: string } | null; editingValue: string;
  onStartEdit: (rowId: string, col: string, val: unknown) => void;
  onEditValue: (v: string) => void; onCommitEdit: () => void;
  onCancelEdit: () => void; onDeleteRow: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <tr onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ background: hover ? 'rgba(99,102,241,0.04)' : 'transparent' }}>
      <td style={{ width: 36, borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 36 }}>
          {hover
            ? <button onClick={() => onDeleteRow(rowId)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: 2 }} title="Delete row">✕</button>
            : <input type="checkbox" style={{ accentColor: '#6366f1' }} />
          }
        </div>
      </td>
      {displayCols.map((col) => {
        const isEditing = editingCell?.rowId === rowId && editingCell?.col === col;
        const system = col === 'id' || col === 'created_at' || col === 'updated_at';
        const raw = row[col];
        return (
          <td key={col} style={{ borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b', padding: 0, maxWidth: 180 }} onClick={() => !system && onStartEdit(rowId, col, raw)}>
            {isEditing ? (
              <input autoFocus value={editingValue} onChange={(e) => onEditValue(e.target.value)}
                onBlur={onCommitEdit} onKeyDown={(e) => { if (e.key === 'Enter') onCommitEdit(); if (e.key === 'Escape') onCancelEdit(); }}
                style={{ width: '100%', height: 36, border: 'none', outline: '2px solid #6366f1', background: '#111827', color: '#e2e8f0', padding: '0 10px', fontSize: 12, boxSizing: 'border-box' }}
              />
            ) : (
              <div style={{ padding: '0 10px', height: 36, display: 'flex', alignItems: 'center', fontSize: 12, color: system ? '#475569' : '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: system ? 'default' : 'text' }}>
                {formatCell(raw)}
              </div>
            )}
          </td>
        );
      })}
      <td style={{ borderBottom: '1px solid #1e293b' }} />
    </tr>
  );
}

// ─── Grid footer ──────────────────────────────────────────────────────────────

function GridFooter({ totalRows, page, totalPages, onPageChange }: {
  totalRows: number; page: number; totalPages: number; onPageChange: (p: number) => void;
}) {
  const [inputVal, setInputVal] = useState(String(page));
  useEffect(() => setInputVal(String(page)), [page]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', borderTop: '1px solid #1e293b', fontSize: 12, color: '#475569', flexShrink: 0, background: '#080d17' }}>
      <span>{totalRows} {totalRows === 1 ? 'row' : 'rows'}</span>
      <div style={{ flex: 1 }} />
      <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} style={{ ...BTN, padding: '2px 8px', opacity: page <= 1 ? 0.3 : 1 }}>‹</button>
      <span>Page</span>
      <input value={inputVal} onChange={(e) => setInputVal(e.target.value)}
        onBlur={() => { const n = parseInt(inputVal, 10); if (!isNaN(n) && n >= 1 && n <= totalPages) onPageChange(n); else setInputVal(String(page)); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(inputVal, 10); if (!isNaN(n) && n >= 1 && n <= totalPages) onPageChange(n); } }}
        style={{ width: 40, textAlign: 'center', background: '#111827', border: '1px solid #374151', borderRadius: 4, padding: '2px 4px', color: '#e2e8f0', fontSize: 12, outline: 'none' }}
      />
      <span>of {totalPages}</span>
      <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={{ ...BTN, padding: '2px 8px', opacity: page >= totalPages ? 0.3 : 1 }}>›</button>
    </div>
  );
}

// ─── Add Column Panel (right-side drawer, WeWeb style) ────────────────────────

function AddColumnPanel({ col, onChange, onSave, onCancel, saving }: {
  col: Partial<BackendColumn>;
  onChange: (c: Partial<BackendColumn>) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, bottom: 0, width: 340, zIndex: 60,
      background: '#0d1526', borderLeft: '1px solid #1e293b',
      display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
    }}>
      {/* Rows */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 0' }}>
        {/* Column Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
            Column Name <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            autoFocus
            value={col.name ?? ''}
            onChange={(e) => onChange({ ...col, name: e.target.value })}
            placeholder="Column name"
            style={INPUT_STYLE}
          />
        </div>

        {/* Column Type */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
            Column Type <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#94a3b8', pointerEvents: 'none', zIndex: 1 }}>
              {typeIcon(col.type ?? 'TEXT')}
            </div>
            <select
              value={col.type ?? 'TEXT'}
              onChange={(e) => onChange({ ...col, type: e.target.value as BackendColumn['type'] })}
              style={{ ...SELECT_STYLE, paddingLeft: 32 }}
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>{typeIcon(t)} {t.charAt(0) + t.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Allow multiple values */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
            onClick={() => onChange({ ...col, nullable: !col.nullable })}>
            <span style={{ fontSize: 13, color: '#e2e8f0' }}>Allow multiple values</span>
            <Toggle on={!!col.nullable} />
          </label>
        </div>

        {/* Default Value */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Default Value</label>
          <input
            value={col.defaultVal ?? ''}
            onChange={(e) => onChange({ ...col, defaultVal: e.target.value || undefined })}
            placeholder="e.g. NOW() or 'hello'"
            style={INPUT_STYLE}
          />
        </div>

        {/* Constraints */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>Constraints</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => onChange({ ...col, required: !col.required })}>
              <span style={{ fontSize: 13, color: '#e2e8f0' }}>Value is required</span>
              <Toggle on={!!col.required} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => onChange({ ...col, unique: !col.unique })}>
              <span style={{ fontSize: 13, color: '#e2e8f0' }}>Value must be unique</span>
              <Toggle on={!!col.unique} />
            </label>
          </div>
        </div>

        {/* Description */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Description</label>
          <RichTextArea value={''} onChange={() => void 0} />
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid #1e293b', flexShrink: 0 }}>
        <button
          onClick={() => void onSave()}
          disabled={saving || !col.name?.trim()}
          style={{ ...BTN_PRIMARY, width: '100%', justifyContent: 'center', padding: '10px 0', fontSize: 13, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Adding…' : 'Add Column'}
        </button>
        <button onClick={onCancel} style={{ ...BTN, width: '100%', justifyContent: 'center', padding: '8px 0', fontSize: 12, marginTop: 6 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── ImportErdModal ───────────────────────────────────────────────────────────

function ImportErdModal({ projectId, onImported, onClose }: {
  projectId: string;
  onImported: (firstTableId?: string) => void;
  onClose: () => void;
}) {
  const [erd, setErd] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ tables: number; workflows: number } | null>(null);
  const [err, setErr] = useState('');

  const tableCount = (erd.match(/^\s*Table\s+\w+/gim) ?? []).length;

  const handleImport = async () => {
    if (!erd.trim()) return;
    setLoading(true);
    setErr('');
    setResult(null);
    try {
      const res = await backendTables.importErd(projectId, erd);
      setResult({ tables: res.tables.length, workflows: res.workflowsCreated });
      onImported(res.tables[0]?.id);
    } catch (e) {
      setErr((e as Error).message ?? 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const OVERLAY: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.65)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  };
  const CARD: React.CSSProperties = {
    background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
    boxShadow: '0 24px 64px rgba(0,0,0,0.7)', width: 560, maxWidth: '95vw',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };
  const INPUT: React.CSSProperties = {
    background: '#111827', border: '1px solid #374151', borderRadius: 6,
    color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', padding: '10px 12px',
    resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={CARD} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Import ERD</span>
            <span style={{ marginLeft: 8, fontSize: 11, color: '#64748b' }}>dbdiagram.io / DBML format</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            value={erd}
            onChange={e => setErd(e.target.value)}
            placeholder={`Table users {\n  id int [pk]\n  name varchar\n  email varchar [unique]\n}\n\nTable orders {\n  id int [pk]\n  user_id int\n  total decimal\n}\n\nRef: orders.user_id > users.id`}
            rows={12}
            style={INPUT}
            disabled={loading}
          />

          {/* Preview */}
          {tableCount > 0 && !result && (
            <div style={{ fontSize: 11, color: '#60a5fa', background: 'rgba(59,130,246,0.08)', borderRadius: 5, padding: '6px 10px' }}>
              {tableCount} table{tableCount !== 1 ? 's' : ''} detected — will create tables + CRUD API endpoints
            </div>
          )}

          {err && (
            <div style={{ fontSize: 11, color: '#f87171', background: 'rgba(239,68,68,0.08)', borderRadius: 5, padding: '6px 10px' }}>{err}</div>
          )}

          {result && (
            <div style={{ fontSize: 11, color: '#34d399', background: 'rgba(52,211,153,0.08)', borderRadius: 5, padding: '6px 10px' }}>
              {result.tables} table{result.tables !== 1 ? 's' : ''} created · {result.workflows} CRUD workflows generated
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '6px 14px', background: 'none', border: '1px solid #374151', borderRadius: 6, color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={() => void handleImport()}
              disabled={loading || !erd.trim()}
              style={{ padding: '6px 16px', background: loading || !erd.trim() ? '#1e3a5f' : '#3b82f6', border: 'none', borderRadius: 6, color: loading || !erd.trim() ? '#4b5563' : '#fff', fontSize: 12, cursor: loading || !erd.trim() ? 'default' : 'pointer', fontWeight: 600 }}
            >
              {loading ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────

// Toggle and PanelFooter are imported from _filter-sort-panels.tsx
