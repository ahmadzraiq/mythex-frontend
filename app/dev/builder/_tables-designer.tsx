'use client';
/**
 * Data Browser — model-first live data grid.
 *
 * Models are the single source of truth for schema (authored in the Models
 * designer). This panel is read-only for schema: it lists models, browses a
 * model's rows via the generic /v1/db data plane, and supports filter / sort /
 * pagination / full-text search plus row-value create / edit / delete.
 *
 * It does NOT create/alter/drop tables or columns — that happens only in the
 * Models designer, which drives the migration engine.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  backendDb,
  type ModelDefinitionJson, type ModelFieldJson,
  type DbListOptions,
} from '@/lib/platform/api-client';
import { useBackendConfig } from '@/lib/builder/use-backend-config';
import {
  type FilterCondition, type FilterGroup, type SortSpec,
  FilterPanel, SortPanel, Toggle, PanelFooter,
} from './_filter-sort-panels';
import { subscribeToChannel } from '@/lib/platform/realtime';

// ─── Helpers ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [0, 20, 50, 100, 1000] as const;

const TYPE_ICON: Record<string, string> = {
  uuid: '⚷', text: 'T', int: '#', bigint: '#', decimal: '#', float: '#',
  bool: '⊟', boolean: '⊟', json: '{}', timestamp: '⎗', datetime: '⎗', date: '⎗',
  file: '⎘', enum: '≡', money: '$', relation: '↔',
};

type ActivePanel = 'insert' | 'columns' | 'filter' | 'sort' | 'pagination' | null;

function typeIcon(type?: string) { return TYPE_ICON[(type ?? 'text').toLowerCase()] ?? 'T'; }

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function formatCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/** The row key that backs a to-one relation field (camelCase FK). */
function fkCamelKey(field: ModelFieldJson): string {
  const raw = field.relation?.field ?? `${camelToSnake(field.name.replace(/Id$/, ''))}_id`;
  return snakeToCamel(raw);
}

/** A scalar column descriptor derived from a model. */
interface GridCol {
  key: string;        // key used to read/write on the row object
  label: string;      // header label
  type: string;       // field type for icon
  system: boolean;    // id / created_at / updated_at / deleted_at
  editable: boolean;  // false for system / computed / relations
  field?: ModelFieldJson;
}

function buildColumns(model: ModelDefinitionJson, rows: Record<string, unknown>[]): GridCol[] {
  const cols: GridCol[] = [];
  const seen = new Set<string>();
  const push = (c: GridCol) => { if (!seen.has(c.key)) { seen.add(c.key); cols.push(c); } };

  push({ key: 'id', label: 'id', type: 'uuid', system: true, editable: false });

  for (const f of model.fields ?? []) {
    if (f.type === 'relation') {
      const kind = f.relation?.kind;
      if (kind === 'manyToOne' || kind === 'oneToOne') {
        push({ key: fkCamelKey(f), label: fkCamelKey(f), type: 'relation', system: false, editable: true, field: f });
      }
      continue; // to-many relations have no scalar column
    }
    const computedVirtual = f.computed && f.computed.persisted === false;
    push({
      key: f.name, label: f.name, type: f.type, system: false,
      editable: !f.computed, field: f,
    });
    void computedVirtual;
  }

  if (model.timestamps !== false) {
    push({ key: 'created_at', label: 'created_at', type: 'timestamp', system: true, editable: false });
    push({ key: 'updated_at', label: 'updated_at', type: 'timestamp', system: true, editable: false });
  }
  if (model.softDelete) push({ key: 'deleted_at', label: 'deleted_at', type: 'timestamp', system: true, editable: false });

  // Surface any extra keys returned by the API that we didn't anticipate.
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (typeof row[k] === 'object' && row[k] !== null) continue; // skip included relations objects
      push({ key: k, label: k, type: 'text', system: true, editable: false });
    }
    break; // first row is enough to discover the shape
  }

  return cols;
}

/** Coerce an edited string to the value type expected by the field. */
function coerceValue(field: ModelFieldJson | undefined, str: string): unknown {
  if (str === '') return null;
  const t = field?.type;
  switch (t) {
    case 'int': case 'bigint': { const n = parseInt(str, 10); return isNaN(n) ? str : n; }
    case 'decimal': case 'float': case 'money': { const n = parseFloat(str); return isNaN(n) ? str : n; }
    case 'bool': case 'boolean': return str === 'true' || str === '1';
    case 'json': try { return JSON.parse(str); } catch { return str; }
    default: return str;
  }
}

/** Convert UI filters to a Prisma-style where object. */
function filtersToWhere(filters: FilterCondition[]): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const f of filters) {
    if (!f.active || !f.field) continue;
    const v = typeof f.value === 'object' && f.value !== null ? (f.value as { formula?: string }).formula ?? '' : f.value;
    switch (f.operator) {
      case 'Is':              where[f.field] = { equals: v }; break;
      case 'Is not':          where[f.field] = { not: v }; break;
      case 'Contains':        where[f.field] = { contains: v }; break;
      case 'Does not contain':where[f.field] = { not: { contains: v } }; break;
      case 'Starts with':     where[f.field] = { startsWith: v }; break;
      case 'Ends with':       where[f.field] = { endsWith: v }; break;
      case 'Is empty':        where[f.field] = null; break;
      case 'Is not empty':    where[f.field] = { not: null }; break;
      default:                where[f.field] = { equals: v };
    }
  }
  return where;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const BTN: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '4px 10px', fontSize: 12, fontWeight: 500,
  background: 'transparent', color: 'var(--bld-text-3)',
  border: '1px solid transparent', borderRadius: 5,
  cursor: 'pointer', whiteSpace: 'nowrap',
};
const BTN_ACTIVE: React.CSSProperties = {
  ...BTN, background: 'rgba(99,102,241,0.15)', color: 'var(--bld-badge-text)',
  border: '1px solid rgba(99,102,241,0.3)',
};
const BTN_PRIMARY: React.CSSProperties = {
  ...BTN, background: 'var(--bld-accent-hover)', color: '#fff',
  border: '1px solid #4f46e5', fontWeight: 600,
};
const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6,
  padding: '8px 12px', fontSize: 13, color: 'var(--bld-text-2)', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};
const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute', zIndex: 50,
  background: 'var(--bld-bg-base)', border: '1px solid var(--bld-bg-elevated)',
  borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  minWidth: 280,
};

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

export function TablesDesigner({ projectId }: Props) {
  const { models, loading: loadingModels } = useBackendConfig(projectId);
  const [modelSearch, setModelSearch] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const onSelectTable = setSelectedTableId;

  const [rows, setRows]             = useState<Record<string, unknown>[]>([]);
  const [totalRows, setTotalRows]   = useState(0);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState<number>(20);
  const [loadingRows, setLoadingRows] = useState(false);

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  const [visibleCols, setVisibleCols]     = useState<string[]>([]);
  const [pendingVisibleCols, setPendingVisibleCols] = useState<string[]>([]);

  const [filters, setFilters]             = useState<FilterCondition[]>([]);
  const [filterGroups, setFilterGroups]   = useState<FilterGroup[]>([]);
  const [pendingFilters, setPendingFilters]         = useState<FilterCondition[]>([]);
  const [pendingFilterGroups, setPendingFilterGroups] = useState<FilterGroup[]>([]);

  const [sorts, setSorts]           = useState<SortSpec[]>([]);
  const [pendingSorts, setPendingSorts] = useState<SortSpec[]>([]);

  const [pendingPageSize, setPendingPageSize] = useState<number>(20);

  const [searchText, setSearchText] = useState('');
  const [live, setLive] = useState(false);

  const [insertRowValues, setInsertRowValues] = useState<Record<string, string>>({});
  const [insertingRow, setInsertingRow] = useState(false);

  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const [error, setError] = useState('');

  const selectedModelNameRef = useRef(selectedTableId);
  const onSelectRef          = useRef(onSelectTable);
  const rowsLoadingRef       = useRef(false);
  useEffect(() => { selectedModelNameRef.current = selectedTableId; }, [selectedTableId]);
  useEffect(() => { onSelectRef.current = onSelectTable; }, [onSelectTable]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedModel = models.find((m) => m.name === selectedTableId) ?? null;

  const cols = selectedModel ? buildColumns(selectedModel, rows) : [];
  const searchable = !!(selectedModel && ((selectedModel.search?.length ?? 0) > 0 || (selectedModel.fields ?? []).some((f) => f.searchable)));

  // Auto-select first model when data loads from shared cache.
  useEffect(() => {
    if (!selectedModelNameRef.current && models.length > 0) {
      onSelectRef.current(models[0].name);
    }
  }, [models]);

  // ── Reset column visibility when model changes ───────────────────────────────
  useEffect(() => {
    if (selectedModel) {
      const all = buildColumns(selectedModel, []).map((c) => c.key);
      setVisibleCols(all);
      setPendingVisibleCols(all);
      setFilters([]); setSorts([]); setSearchText(''); setPage(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel?.name]);

  // ── Load rows ────────────────────────────────────────────────────────────────
  const loadRows = useCallback(async () => {
    if (!selectedModel) return;
    if (rowsLoadingRef.current) return;
    rowsLoadingRef.current = true;
    setLoadingRows(true);
    try {
      const where = filtersToWhere(filters);
      const orderBy = sorts.map((s) => ({ [s.field]: s.dir }));
      const opts: DbListOptions = {
        where: Object.keys(where).length ? where : undefined,
        orderBy: orderBy.length ? orderBy : undefined,
        search: searchText || undefined,
        page,
        pageSize: pageSize === 0 ? 500 : pageSize,
      };
      const res = await backendDb.list(projectId, selectedModel.name, opts);
      setRows(res.data ?? []);
      setTotalRows(res.total ?? 0);
    } catch (e) { setError((e as Error).message); }
    finally { setLoadingRows(false); rowsLoadingRef.current = false; }
  }, [projectId, selectedModel, filters, sorts, searchText, page, pageSize]);

  useEffect(() => { if (selectedModel) void loadRows(); }, [loadRows]);

  // ── Live updates (realtime) ──────────────────────────────────────────────────
  const loadRowsRef = useRef(loadRows);
  useEffect(() => { loadRowsRef.current = loadRows; }, [loadRows]);
  useEffect(() => {
    if (!live || !selectedModel) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeToChannel(projectId, `model:${projectId}:${selectedModel.name}`, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void loadRowsRef.current(); }, 300);
    });
    return () => { if (timer) clearTimeout(timer); unsub(); };
  }, [live, projectId, selectedModel]);

  const displayCols = cols.filter((c) => visibleCols.includes(c.key));
  const colByKey = (key: string) => cols.find((c) => c.key === key);

  // ── Panel toggle ───────────────────────────────────────────────────────────
  const togglePanel = (p: ActivePanel) => {
    if (activePanel === p) { setActivePanel(null); return; }
    if (p === 'columns') setPendingVisibleCols([...visibleCols]);
    if (p === 'filter') { setPendingFilters([...filters]); setPendingFilterGroups([...filterGroups]); }
    if (p === 'sort') setPendingSorts([...sorts]);
    if (p === 'pagination') setPendingPageSize(pageSize);
    setActivePanel(p);
  };

  // ── Row CRUD ─────────────────────────────────────────────────────────────────
  const handleInsertRow = async () => {
    if (!selectedModel) return;
    setInsertingRow(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const c of cols) {
        if (!c.editable) continue;
        const raw = insertRowValues[c.key];
        if (raw !== undefined && raw !== '') payload[c.key] = coerceValue(c.field, raw);
      }
      await backendDb.create(projectId, selectedModel.name, payload);
      setInsertRowValues({});
      setActivePanel(null);
      await loadRows();
    } catch (e) { setError((e as Error).message); }
    finally { setInsertingRow(false); }
  };

  const commitEdit = async () => {
    if (!editingCell || !selectedModel) return;
    const col = colByKey(editingCell.col);
    try {
      const value = coerceValue(col?.field, editingValue);
      await backendDb.update(projectId, selectedModel.name, editingCell.rowId, { [editingCell.col]: value });
      setRows((prev) => prev.map((r) =>
        String(r.id) === editingCell.rowId ? { ...r, [editingCell.col]: value } : r,
      ));
    } catch (e) { setError((e as Error).message); }
    finally { setEditingCell(null); }
  };

  const deleteRow = async (rowId: string) => {
    if (!selectedModel || !confirm('Delete this row?')) return;
    try {
      await backendDb.delete(projectId, selectedModel.name, rowId);
      setRows((prev) => prev.filter((r) => String(r.id) !== rowId));
      setTotalRows((n) => n - 1);
    } catch (e) { setError((e as Error).message); }
  };

  const filteredModels = models.filter((m) =>
    m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
    (m.table ?? '').toLowerCase().includes(modelSearch.toLowerCase()),
  );

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      flex: 1, display: 'flex', height: '100%', overflow: 'hidden', position: 'relative',
    }}>
      {activePanel && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40 }} onClick={() => setActivePanel(null)} />
      )}

      {/* Sidebar */}
      <ModelSidebar
        models={filteredModels}
        search={modelSearch}
        onSearchChange={setModelSearch}
        selected={selectedTableId}
        onSelect={(name) => { onSelectTable(name); setActivePanel(null); }}
        loading={loadingModels}
        onRefresh={() => {}}
      />

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', background: 'var(--bld-bg-canvas)', backgroundImage: 'radial-gradient(ellipse 70% 45% at 85% 8%, rgba(99,102,241,0.07) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 10% 95%, rgba(124,58,237,0.07) 0%, transparent 55%)' }}>
        {!selectedModel && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
              boxShadow: '0 0 32px rgba(99,102,241,0.12)',
            }}>
              <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="2"/>
                <line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/>
                <line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="10" x2="14" y2="10"/>
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--bld-text-2)', marginBottom: 6 }}>
                {loadingModels ? 'Loading…' : models.length === 0 ? 'No models yet' : 'Select a table'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)', maxWidth: 260, lineHeight: 1.6 }}>
                {models.length === 0 ? 'Go to Models to create your first model.' : 'Choose a table from the sidebar to browse and edit its data.'}
              </div>
            </div>
          </div>
        )}

        {selectedModel && (
          <>
            {/* Toolbar */}
            <Toolbar
              activePanel={activePanel}
              onTogglePanel={togglePanel}
              onRefresh={() => void loadRows()}
              hasActiveFilters={filters.filter((f) => f.active).length > 0}
              hasActiveSorts={sorts.length > 0}
              searchable={searchable}
              searchText={searchText}
              onSearchChange={setSearchText}
              onSearchSubmit={() => { setPage(1); void loadRows(); }}
              live={live}
              onToggleLive={() => setLive((v) => !v)}
            />

            {/* Panel popovers */}
            <div style={{ position: 'relative', zIndex: 41 }}>
              {activePanel === 'insert' && (
                <InsertPanel
                  cols={cols.filter((c) => c.editable)}
                  values={insertRowValues}
                  onChange={setInsertRowValues}
                  onInsert={() => void handleInsertRow()}
                  inserting={insertingRow}
                  onClose={() => setActivePanel(null)}
                />
              )}
              {activePanel === 'columns' && (
                <ColumnsPanel
                  cols={cols}
                  pending={pendingVisibleCols}
                  onChange={setPendingVisibleCols}
                  onReset={() => setPendingVisibleCols(cols.map((c) => c.key))}
                  onSave={() => { setVisibleCols(pendingVisibleCols); setActivePanel(null); }}
                />
              )}
              {activePanel === 'filter' && (
                <FilterPanel
                  asPopover
                  conditions={pendingFilters}
                  groups={pendingFilterGroups}
                  allCols={cols.map((c) => c.key)}
                  onChange={setPendingFilters}
                  onChangeGroups={setPendingFilterGroups}
                  onReset={() => { setPendingFilters([]); setPendingFilterGroups([]); }}
                  onSave={() => { setFilters(pendingFilters); setFilterGroups(pendingFilterGroups); setPage(1); setActivePanel(null); }}
                />
              )}
              {activePanel === 'sort' && (
                <SortPanel
                  asPopover
                  pending={pendingSorts}
                  allCols={cols.map((c) => c.key)}
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

            {/* Grid */}
            <DataGrid
              rows={rows}
              displayCols={displayCols}
              loading={loadingRows}
              editingCell={editingCell}
              editingValue={editingValue}
              onStartEdit={(rowId, col, val) => {
                const c = colByKey(col);
                if (!c?.editable) return;
                setEditingCell({ rowId, col });
                setEditingValue(val === null || val === undefined ? '' : formatCell(val));
              }}
              onEditValue={setEditingValue}
              onCommitEdit={() => void commitEdit()}
              onCancelEdit={() => setEditingCell(null)}
              onDeleteRow={(id) => void deleteRow(id)}
            />

            <GridFooter totalRows={totalRows} page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </div>

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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function ModelSidebar({
  models, search, onSearchChange, selected, onSelect, loading, onRefresh,
}: {
  models: ModelDefinitionJson[];
  search: string;
  onSearchChange: (v: string) => void;
  selected: string | null;
  onSelect: (name: string) => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  const sideInputStyle: React.CSSProperties = {
    background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4,
    padding: '4px 8px', fontSize: 11, color: 'var(--bld-text-2)', outline: 'none',
    width: '100%', boxSizing: 'border-box',
  };

  return (
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
            <line x1="6" y1="2" x2="6" y2="14"/><line x1="2" y1="7" x2="14" y2="7"/>
          </svg>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--bld-text-2)', letterSpacing: 0.3 }}>Tables</span>
        </div>
        <button onClick={onRefresh} title="Refresh" style={{ ...BTN, padding: '4px 8px', border: '1px solid var(--bld-border-subtle)' }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.1L1 10"/>
          </svg>
        </button>
      </div>
      {/* Search */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
        <div style={{ position: 'relative' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--bld-text-disabled)" strokeWidth="1.8" strokeLinecap="round" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
          </svg>
          <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search tables…"
            style={{ ...sideInputStyle, paddingLeft: 28 }} />
        </div>
      </div>
      {/* List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--bld-text-disabled)' }}>Loading…</div>}
        {!loading && models.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>
            No models yet.<br />Create one in <strong style={{ color: 'var(--bld-text-3)' }}>Models</strong>.
          </div>
        )}
        {models.map((m) => {
          const active = m.name === selected;
          return (
            <div key={m.id ?? m.name} onClick={() => onSelect(m.name)} style={{
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
                <line x1="6" y1="2" x2="6" y2="14"/><line x1="2" y1="7" x2="14" y2="7"/>
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
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({
  activePanel, onTogglePanel, onRefresh, hasActiveFilters, hasActiveSorts,
  searchable, searchText, onSearchChange, onSearchSubmit,
  live, onToggleLive,
}: {
  activePanel: ActivePanel;
  onTogglePanel: (p: ActivePanel) => void;
  onRefresh: () => void;
  hasActiveFilters: boolean;
  hasActiveSorts: boolean;
  searchable: boolean;
  searchText: string;
  onSearchChange: (v: string) => void;
  onSearchSubmit: () => void;
  live: boolean;
  onToggleLive: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
      <button style={activePanel === 'insert' ? BTN_ACTIVE : BTN_PRIMARY} onClick={() => onTogglePanel('insert')}>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
        Insert row
      </button>
      <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />
      <button style={activePanel === 'columns' ? BTN_ACTIVE : BTN} onClick={() => onTogglePanel('columns')}>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="1" width="10" height="10" rx="1"/><line x1="4" y1="1" x2="4" y2="11"/><line x1="8" y1="1" x2="8" y2="11"/></svg>
        Columns
      </button>
      <button style={activePanel === 'filter' ? BTN_ACTIVE : (hasActiveFilters ? { ...BTN, color: '#a5b4fc' } : BTN)} onClick={() => onTogglePanel('filter')}>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="2" y1="3" x2="10" y2="3"/><line x1="3.5" y1="6" x2="8.5" y2="6"/><line x1="5" y1="9" x2="7" y2="9"/></svg>
        Filter{hasActiveFilters && <span style={{ fontSize: 10, background: 'var(--bld-accent)', color: '#fff', borderRadius: 8, padding: '1px 5px', marginLeft: 2 }}>ON</span>}
      </button>
      <button style={activePanel === 'sort' ? BTN_ACTIVE : (hasActiveSorts ? { ...BTN, color: '#a5b4fc' } : BTN)} onClick={() => onTogglePanel('sort')}>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="2" y1="3" x2="10" y2="3"/><line x1="4" y1="6" x2="10" y2="6"/><line x1="6" y1="9" x2="10" y2="9"/></svg>
        Sort{hasActiveSorts && <span style={{ fontSize: 10, background: 'var(--bld-accent)', color: '#fff', borderRadius: 8, padding: '1px 5px', marginLeft: 2 }}>ON</span>}
      </button>
      <button style={activePanel === 'pagination' ? BTN_ACTIVE : BTN} onClick={() => onTogglePanel('pagination')}>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="3" width="10" height="6" rx="1"/><line x1="4" y1="3" x2="4" y2="9"/><line x1="8" y1="3" x2="8" y2="9"/></svg>
        Rows
      </button>
      <div style={{ flex: 1 }} />
      {searchable && (
        <div style={{ position: 'relative' }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--bld-text-disabled)" strokeWidth="1.8" strokeLinecap="round" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
          </svg>
          <input value={searchText} onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSearchSubmit(); }}
            placeholder="Search rows…"
            style={{ ...INPUT_STYLE, width: 180, padding: '5px 10px 5px 28px', fontSize: 12 }}
          />
        </div>
      )}
      <button onClick={onToggleLive} title="Live updates" style={live ? { ...BTN_ACTIVE, gap: 6 } : { ...BTN, gap: 6, border: '1px solid rgba(255,255,255,0.08)' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: live ? '#34d399' : 'var(--bld-text-disabled)', boxShadow: live ? '0 0 6px #34d399' : 'none' }} />
        Live
      </button>
      <button style={{ ...BTN, gap: 5, border: '1px solid rgba(255,255,255,0.08)' }} onClick={onRefresh}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.1L1 10"/>
        </svg>
        Refresh
      </button>
    </div>
  );
}

// ─── Insert panel ─────────────────────────────────────────────────────────────

function InsertPanel({
  cols, values, onChange, onInsert, inserting, onClose,
}: {
  cols: GridCol[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  onInsert: () => void;
  inserting: boolean;
  onClose: () => void;
}) {
  return (
    <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 320, maxHeight: 440, overflow: 'auto' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>Insert a row</span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cols.map((c) => (
          <div key={c.key}>
            <label style={{ fontSize: 11, color: 'var(--bld-text-3)', fontWeight: 500, display: 'block', marginBottom: 3 }}>
              {typeIcon(c.type)} {c.label}
              {c.field?.required && <span style={{ color: 'var(--bld-error)', marginLeft: 2 }}>*</span>}
            </label>
            <input
              style={{ ...INPUT_STYLE, fontSize: 12, padding: '4px 8px' }}
              value={values[c.key] ?? ''}
              placeholder={c.type === 'bool' || c.type === 'boolean' ? 'true / false' : c.type}
              onChange={(e) => onChange({ ...values, [c.key]: e.target.value })}
            />
          </div>
        ))}
        {cols.length === 0 && <p style={{ fontSize: 12, color: 'var(--bld-text-disabled)' }}>No editable fields.</p>}
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--bld-bg-elevated)', display: 'flex', gap: 8 }}>
        <button onClick={onInsert} disabled={inserting} style={{ ...BTN_PRIMARY, flex: 1, justifyContent: 'center', opacity: inserting ? 0.6 : 1 }}>
          {inserting ? 'Inserting…' : 'Insert row'}
        </button>
        <button onClick={onClose} style={{ ...BTN, border: '1px solid var(--bld-border-subtle)' }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Columns panel ────────────────────────────────────────────────────────────

function ColumnsPanel({ cols, pending, onChange, onReset, onSave }: {
  cols: GridCol[];
  pending: string[];
  onChange: (v: string[]) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const toggle = (key: string) =>
    onChange(pending.includes(key) ? pending.filter((c) => c !== key) : [...pending, key]);

  return (
    <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 260 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>Columns</span>
      </div>
      <div style={{ padding: '6px 0', maxHeight: 280, overflow: 'auto' }}>
        {cols.map((c) => {
          const on = pending.includes(c.key);
          return (
            <div key={c.key} onClick={() => toggle(c.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', cursor: 'pointer' }}>
              <Toggle on={on} />
              <span style={{ fontSize: 12, color: 'var(--bld-text-disabled)', width: 16, textAlign: 'center', flexShrink: 0 }}>{typeIcon(c.type)}</span>
              <span style={{ fontSize: 12, color: 'var(--bld-text-2)' }}>{c.label}</span>
            </div>
          );
        })}
      </div>
      <PanelFooter onReset={onReset} onSave={onSave} />
    </div>
  );
}

// ─── Pagination panel ─────────────────────────────────────────────────────────

function PaginationPanel({ pending, onChange, onSave }: { pending: number; onChange: (v: number) => void; onSave: () => void }) {
  return (
    <div style={{ ...PANEL_STYLE, top: 0, left: 12, minWidth: 320 }}>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', marginBottom: 10 }}>Rows per page</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PAGE_SIZE_OPTIONS.map((opt) => (
            <button key={opt} onClick={() => onChange(opt)} style={{
              padding: '5px 14px', fontSize: 12, borderRadius: 20, cursor: 'pointer',
              background: pending === opt ? 'rgba(99,102,241,0.2)' : 'transparent',
              border: `1px solid ${pending === opt ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`,
              color: pending === opt ? 'var(--bld-badge-text)' : 'var(--bld-text-3)',
              fontWeight: pending === opt ? 600 : 400,
            }}>
              {opt === 0 ? 'Max (500)' : opt}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--bld-bg-elevated)', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onSave} style={{ ...BTN_PRIMARY, padding: '5px 16px' }}>Save</button>
      </div>
    </div>
  );
}

// ─── Data grid ────────────────────────────────────────────────────────────────

function DataGrid({
  rows, displayCols, loading,
  editingCell, editingValue,
  onStartEdit, onEditValue, onCommitEdit, onCancelEdit, onDeleteRow,
}: {
  rows: Record<string, unknown>[];
  displayCols: GridCol[];
  loading: boolean;
  editingCell: { rowId: string; col: string } | null;
  editingValue: string;
  onStartEdit: (rowId: string, col: string, val: unknown) => void;
  onEditValue: (v: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDeleteRow: (id: string) => void;
}) {
  const COL_WIDTH = 180;
  const BORDER = '1px solid rgba(255,255,255,0.05)';
  return (
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
      {/* Overlay sits OUTSIDE the scroll container so it always covers the full area */}
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, backdropFilter: 'blur(6px)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 28, height: 28, border: '2.5px solid rgba(99,102,241,0.25)', borderTopColor: '#818cf8', borderRadius: '50%', animation: 'spin 0.7s linear infinite', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }} />
            <span style={{ fontSize: 12, color: 'rgba(165,180,252,0.8)', letterSpacing: 0.3 }}>Loading…</span>
          </div>
        </div>
      )}
      <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.025)', position: 'sticky', top: 0, zIndex: 5 }}>
            <th style={{ width: 40, borderBottom: BORDER, borderRight: BORDER, padding: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 36 }}>
                <input type="checkbox" style={{ accentColor: 'var(--bld-accent)' }} />
              </div>
            </th>
            {displayCols.map((c) => (
              <th key={c.key} style={{ width: COL_WIDTH, borderBottom: BORDER, borderRight: BORDER, padding: 0, textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', height: 36 }}>
                  <span style={{ fontSize: 11, color: 'rgba(99,102,241,0.7)', flexShrink: 0, fontFamily: 'monospace' }}>{typeIcon(c.type)}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.75)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={displayCols.length + 1} style={{ padding: 60, textAlign: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
                    boxShadow: '0 0 32px rgba(99,102,241,0.12)',
                  }}>
                    <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="12" height="12" rx="2"/>
                      <line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/>
                      <line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="10" x2="14" y2="10"/>
                    </svg>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--bld-text-2)', marginBottom: 6 }}>No rows yet</div>
                    <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)', lineHeight: 1.6 }}>
                      Click <strong style={{ color: 'var(--bld-text-3)' }}>Insert row</strong> to add your first record.
                    </div>
                  </div>
                </div>
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
    </div>
  );
}

function DataRow({
  row, rowId, displayCols, editingCell, editingValue,
  onStartEdit, onEditValue, onCommitEdit, onCancelEdit, onDeleteRow,
}: {
  row: Record<string, unknown>; rowId: string; displayCols: GridCol[];
  editingCell: { rowId: string; col: string } | null; editingValue: string;
  onStartEdit: (rowId: string, col: string, val: unknown) => void;
  onEditValue: (v: string) => void; onCommitEdit: () => void;
  onCancelEdit: () => void; onDeleteRow: (id: string) => void;
}) {
  const BORDER = '1px solid rgba(255,255,255,0.05)';
  const [hover, setHover] = useState(false);
  return (
    <tr onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: hover ? 'rgba(99,102,241,0.045)' : 'transparent', transition: 'background 0.1s' }}>
      <td style={{ width: 40, borderBottom: BORDER, borderRight: BORDER, padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 38 }}>
          {hover
            ? <button onClick={() => onDeleteRow(rowId)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 4, borderRadius: 4, lineHeight: 1 }} title="Delete row">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
              </button>
            : <input type="checkbox" style={{ accentColor: 'var(--bld-accent)' }} />
          }
        </div>
      </td>
      {displayCols.map((c) => {
        const isEditing = editingCell?.rowId === rowId && editingCell?.col === c.key;
        const raw = row[c.key];
        const isEmpty = raw === null || raw === undefined || raw === '';
        return (
          <td key={c.key} style={{ borderBottom: BORDER, borderRight: BORDER, padding: 0, maxWidth: 180 }} onClick={() => c.editable && onStartEdit(rowId, c.key, raw)}>
            {isEditing ? (
              <input autoFocus value={editingValue} onChange={(e) => onEditValue(e.target.value)}
                onBlur={onCommitEdit} onKeyDown={(e) => { if (e.key === 'Enter') onCommitEdit(); if (e.key === 'Escape') onCancelEdit(); }}
                style={{ width: '100%', height: 38, border: 'none', outline: '1px solid rgba(99,102,241,0.6)', outlineOffset: -1, background: 'rgba(99,102,241,0.08)', color: '#e2e8f0', padding: '0 12px', fontSize: 12, boxSizing: 'border-box' }}
              />
            ) : (
              <div style={{ padding: '0 12px', height: 38, display: 'flex', alignItems: 'center', fontSize: 12, color: isEmpty ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: c.editable ? 'text' : 'default', fontFamily: c.type === 'uuid' ? 'monospace' : undefined }}>
                {isEmpty ? '—' : formatCell(raw)}
              </div>
            )}
          </td>
        );
      })}
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12, color: 'var(--bld-text-disabled)', flexShrink: 0, background: 'rgba(0,0,0,0.2)' }}>
      <span>{totalRows} {totalRows === 1 ? 'row' : 'rows'}</span>
      <div style={{ flex: 1 }} />
      <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} style={{ ...BTN, padding: '2px 8px', opacity: page <= 1 ? 0.3 : 1 }}>‹</button>
      <span>Page</span>
      <input value={inputVal} onChange={(e) => setInputVal(e.target.value)}
        onBlur={() => { const n = parseInt(inputVal, 10); if (!isNaN(n) && n >= 1 && n <= totalPages) onPageChange(n); else setInputVal(String(page)); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(inputVal, 10); if (!isNaN(n) && n >= 1 && n <= totalPages) onPageChange(n); } }}
        style={{ width: 40, textAlign: 'center', background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, padding: '2px 4px', color: 'var(--bld-text-2)', fontSize: 12, outline: 'none' }}
      />
      <span>of {totalPages}</span>
      <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={{ ...BTN, padding: '2px 8px', opacity: page >= totalPages ? 0.3 : 1 }}>›</button>
    </div>
  );
}
