'use client';

/**
 * /dev/builder — Figma-like visual page builder
 *
 * Layout:
 *   ┌────────────────────────────────────────────────┐
 *   │              Top Bar                           │
 *   ├───────────┬────────────────────┬───────────────┤
 *   │ Left Panel│     Canvas         │  Right Panel  │
 *   │ (Layers / │  (iframe + overlay │  (Design /    │
 *   │  Comps)   │   zoom + pan)      │   Props/JSON) │
 *   └───────────┴────────────────────┴───────────────┘
 *
 * Keyboard shortcuts:
 *   Cmd+Z / Cmd+Shift+Z — undo / redo
 *   Cmd+C / Cmd+V       — copy / paste
 *   Cmd+D               — duplicate
 *   Cmd+G               — group
 *   Cmd+A               — select all
 *   Delete / Backspace  — delete selected
 *   Escape              — deselect
 *   Alt (held)          — alt-hover distance mode
 *   Nudge: Arrow keys   — move (not yet wired to pixels; placeholder)
 *   Cmd+P               — toggle preview
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useBuilderStore, restorePreviewData, VIEWPORT_WIDTHS, type ViewportSize } from './_store';
import { useSduiStore } from '@/store/sdui-store';
import type { BuilderPage } from './_store';
import BuilderCanvas from './_canvas';
import PanelLeft, { PageConfigSlidePanelContent } from './_panel-left';
import PanelRight from './_panel-right';
import { SlidePanel } from './_slide-panel';
import {
  DataSlidePanelContent,
  getDataSlideTitle,
  type DataTabSlideState,
} from './_data-tab';
import {
  LogicSlidePanelContent,
  getLogicSlideTitle,
  type LogicSlideState,
} from './_logic-tab';
import routes from '@/config/routes.json';
import { WorkflowCanvas } from './_workflow-canvas';

void useRef; void useState; // suppress unused-import lint

/** localStorage key used to hand off page data to the preview tab. */
export const BUILDER_PREVIEW_KEY = 'builder_preview';

// ─── Dark/Light mode toggle ───────────────────────────────────────────────────

function DarkModeToggle() {
  const [dark, setDark] = useState(false);

  // Sync initial state from document
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const isDark = !dark;
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  };

  return (
    <button
      onClick={toggle}
      title={dark ? 'Switch to Light mode' : 'Switch to Dark mode'}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px',
        background: dark ? '#1e293b' : '#f1f5f9',
        border: `1px solid ${dark ? '#334155' : '#cbd5e1'}`,
        borderRadius: 5,
        color: dark ? '#f1f5f9' : '#1e293b',
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: 'system-ui',
        transition: 'all 0.15s',
      }}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────

const VIEWPORT_LABELS: Record<ViewportSize, string> = {
  mobile:  '390',
  tablet:  '768',
  laptop:  '1024',
  desktop: '1280',
};
const VIEWPORT_ICONS: Record<ViewportSize, string> = {
  mobile:  '📱',
  tablet:  '📟',
  laptop:  '💻',
  desktop: '🖥',
};

// ─── Pages Picker Dropdown ────────────────────────────────────────────────────

function PagesPicker() {
  const { pages, currentPageId, addPage, navigatePage, renamePage, removePage } = useBuilderStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [customRoute, setCustomRoute] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const currentPage = pages.find(p => p.id === currentPageId);
  const allRoutes = (routes as { routes: Array<{ path: string; config: string }> }).routes;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowAdd(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim()) renamePage(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, renamePage]);

  const handleAddCustom = useCallback(() => {
    const r = customRoute.trim();
    if (!r) return;
    const path = r.startsWith('/') ? r : `/${r}`;
    const existing = pages.find((p: BuilderPage) => p.route === path);
    if (existing) navigatePage(existing.id);
    else addPage(path, path);
    setCustomRoute('');
    setShowAdd(false);
  }, [customRoute, pages, addPage, navigatePage]);

  const filtered = pages.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.route ?? '').includes(search)
  );

  return (
    <div ref={containerRef} style={{ position: 'relative' }} data-testid="pages-picker">
      {/* Trigger button */}
      <button
        data-testid="pages-picker-trigger"
        onClick={() => { setOpen(v => !v); setSearch(''); setShowAdd(false); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px',
          background: open ? '#1f2937' : 'transparent',
          border: `1px solid ${open ? '#3b82f6' : '#374151'}`,
          borderRadius: 6,
          color: '#d1d5db',
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'system-ui',
          minWidth: 120,
          maxWidth: 220,
        }}
      >
        <span style={{ fontSize: 12, opacity: 0.7 }}>📄</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: '#f3f4f6' }}>
          {currentPage?.name ?? 'Select page'}
        </span>
        {currentPage?.route && (
          <span style={{ fontSize: 9, color: '#6b7280', fontFamily: 'monospace', flexShrink: 0 }}>
            {currentPage.route}
          </span>
        )}
        <span style={{ color: '#6b7280', fontSize: 9, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 260,
            maxWidth: 320,
            background: '#111827',
            border: '1px solid #374151',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
            zIndex: 99999,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2937' }}>
            <input
              autoFocus
              placeholder="Search pages…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', background: '#1f2937', border: '1px solid #374151',
                borderRadius: 5, color: '#d1d5db', fontSize: 11, padding: '5px 8px',
                boxSizing: 'border-box', outline: 'none',
              }}
            />
          </div>

          {/* Page list */}
          <div style={{ overflowY: 'auto', maxHeight: 260 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 11, color: '#4b5563', fontStyle: 'italic' }}>No pages match</div>
            )}
            {filtered.map((page: BuilderPage) => {
              const isActive = page.id === currentPageId;
              const isRenaming = renamingId === page.id;
              return (
                <div
                  key={page.id}
                  data-testid={`pages-picker-row-${page.id}`}
                  onClick={() => {
                    if (!isRenaming) { navigatePage(page.id); setOpen(false); setSearch(''); }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', cursor: 'pointer',
                    background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
                    borderLeft: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 12, opacity: 0.6, flexShrink: 0 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); e.stopPropagation(); }}
                        onClick={e => e.stopPropagation()}
                        style={{ width: '100%', background: '#1f2937', border: '1px solid #3b82f6', borderRadius: 3, color: '#f3f4f6', fontSize: 11, padding: '1px 5px', boxSizing: 'border-box' }}
                      />
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: isActive ? '#f3f4f6' : '#d1d5db', fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          onDoubleClick={e => { e.stopPropagation(); setRenamingId(page.id); setRenameValue(page.name); }}>
                          {page.name}
                        </div>
                        {page.route && <div style={{ fontSize: 9, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.route}</div>}
                      </>
                    )}
                  </div>
                  {pages.length > 1 && !isRenaming && (
                    <button title="Remove page" onClick={e => { e.stopPropagation(); removePage(page.id); }}
                      style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: '2px 4px', borderRadius: 3, flexShrink: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}>×</button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add page / route picker */}
          <div style={{ borderTop: '1px solid #1f2937' }}>
            {!showAdd ? (
              <button
                data-testid="pages-picker-add"
                onClick={() => setShowAdd(true)}
                style={{
                  width: '100%', padding: '8px 12px', background: 'transparent', border: 'none',
                  color: '#6b7280', fontSize: 11, cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'system-ui',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#d1d5db')}
                onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
              >
                <span style={{ fontSize: 14 }}>+</span> Add page
              </button>
            ) : (
              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Custom route */}
                <div style={{ fontSize: 10, color: '#6b7280', letterSpacing: '0.04em' }}>CUSTOM ROUTE</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input autoFocus placeholder="/my-page" value={customRoute}
                    onChange={e => setCustomRoute(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCustom(); if (e.key === 'Escape') setShowAdd(false); e.stopPropagation(); }}
                    style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#f3f4f6', fontSize: 11, padding: '4px 8px', outline: 'none', fontFamily: 'monospace' }}
                  />
                  <button onClick={handleAddCustom} disabled={!customRoute.trim()}
                    style={{ padding: '4px 10px', background: customRoute.trim() ? '#1d4ed8' : '#374151', border: 'none', borderRadius: 4, color: customRoute.trim() ? '#fff' : '#6b7280', fontSize: 11, cursor: customRoute.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
                    Add
                  </button>
                </div>
                {/* App routes */}
                <div style={{ fontSize: 10, color: '#6b7280', letterSpacing: '0.04em', marginTop: 4 }}>APP ROUTES</div>
                <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {allRoutes.map(r => {
                    const alreadyAdded = pages.some((p: BuilderPage) => p.route === r.path);
                    return (
                      <button key={r.config} disabled={alreadyAdded}
                        onClick={() => { if (!alreadyAdded) { addPage(r.path, r.config); setShowAdd(false); setOpen(false); } }}
                        style={{ display: 'flex', width: '100%', alignItems: 'baseline', gap: 6, padding: '5px 4px', background: 'none', border: 'none', color: alreadyAdded ? '#4b5563' : '#d1d5db', fontSize: 11, textAlign: 'left', cursor: alreadyAdded ? 'default' : 'pointer' }}
                        onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; }}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: alreadyAdded ? '#374151' : '#60a5fa', flexShrink: 0 }}>{r.path}</span>
                        <span style={{ opacity: alreadyAdded ? 0.35 : 0.6 }}>{r.config}</span>
                        {alreadyAdded && <span style={{ marginLeft: 'auto', fontSize: 9, color: '#374151' }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TopBar({ onPreview }: { onPreview: () => void }) {
  const { undo, redo, historyIdx, history, selectedIds, pageNodes, viewport, setViewport } = useBuilderStore();
  const canUndo = historyIdx > 0;
  const canRedo = historyIdx < history.length - 1;

  return (
    <div
      style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        background: '#0f172a',
        borderBottom: '1px solid #1f2937',
        padding: '0 12px',
        gap: 8,
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      {/* Logo / nav back */}
      <a
        href="/dev/sections"
        style={{ color: '#6b7280', fontSize: 11, textDecoration: 'none', marginRight: 8, whiteSpace: 'nowrap' }}
      >
        ← Sections
      </a>

      <div style={{ width: 1, height: 20, background: '#1f2937' }} />

      {/* History */}
      <TopBarBtn disabled={!canUndo} onClick={undo} title="Undo (⌘Z)"   testId="btn-undo">↩</TopBarBtn>
      <TopBarBtn disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)" testId="btn-redo">↪</TopBarBtn>

      <div style={{ width: 1, height: 20, background: '#1f2937' }} />

      {/* Pages picker dropdown (replaces the static page name in the centre) */}
      <PagesPicker />

      <div style={{ flex: 1 }} />

      {/* ── Responsive viewport breakpoints ── */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {(Object.keys(VIEWPORT_WIDTHS) as ViewportSize[]).map(v => (
          <button
            key={v}
            data-testid={`viewport-${v}`}
            onClick={() => setViewport(v)}
            title={`${v} (${VIEWPORT_LABELS[v]}px)`}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '3px 7px',
              background: viewport === v ? '#1d4ed8' : 'transparent',
              border: `1px solid ${viewport === v ? '#3b82f6' : 'transparent'}`,
              borderRadius: 4,
              color: viewport === v ? '#fff' : '#6b7280',
              cursor: 'pointer',
              fontSize: 10,
              fontFamily: 'system-ui',
            }}
          >
            <span>{VIEWPORT_ICONS[v]}</span>
            <span>{VIEWPORT_LABELS[v]}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Dark / Light mode toggle */}
      <DarkModeToggle />

      {/* Preview button — saves to localStorage then opens /dev/builder/preview in new tab */}
      <button
        data-testid="btn-preview"
        onClick={onPreview}
        title="Preview in new tab (⌘P)"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 12px',
          background: '#10b981',
          border: 'none',
          borderRadius: 5,
          color: '#fff',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'system-ui',
          letterSpacing: '0.02em',
        }}
      >
        ↗ Preview
      </button>

      <div style={{ width: 1, height: 20, background: '#1f2937' }} />

      {/* Node count */}
      <span style={{ fontSize: 10, color: '#4b5563' }}>
        {pageNodes.length} section{pageNodes.length !== 1 ? 's' : ''}
      </span>

      {selectedIds.length > 0 && (
        <span style={{ fontSize: 10, color: '#3b82f6' }}>
          · {selectedIds.length} selected
        </span>
      )}
    </div>
  );
}


function TopBarBtn({
  children,
  onClick,
  disabled,
  title,
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      style={{
        width: 26,
        height: 26,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        color: disabled ? '#374151' : '#9ca3af',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 13,
        borderRadius: 4,
      }}
    >
      {children}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Left slide state ─────────────────────────────────────────────────────────

type LeftSlideState =
  | { kind: 'data'; subState: DataTabSlideState }
  | { kind: 'logic'; subState: LogicSlideState }
  | { kind: 'pageConfig' }
  | null;

function leftSlideTitle(state: LeftSlideState): string {
  if (!state) return '';
  if (state.kind === 'data') return getDataSlideTitle(state.subState);
  if (state.kind === 'logic') return getLogicSlideTitle(state.subState);
  if (state.kind === 'pageConfig') return 'Page Settings';
  return '';
}

export default function BuilderPage() {
  const store = useBuilderStore();
  const initTheme = useBuilderStore(s => s.initTheme);
  const loadFromConfig = useBuilderStore(s => s.loadFromConfig);
  const workflowCanvasTarget = useBuilderStore(s => s.workflowCanvasTarget);
  const closeWorkflowCanvas = useBuilderStore(s => s.closeWorkflowCanvas);
  const [leftSlide, setLeftSlide] = useState<LeftSlideState>(null);
  const [leftSlideWidth, setLeftSlideWidth] = useState(320);

  // Install Gluestack primary token bridge immediately on mount so Checkbox,
  // Radio, Switch etc. reflect --primary even before a preset is applied.
  useEffect(() => { initTheme(); }, [initTheme]);

  // Seed builder panels from app config files on first load (if empty)
  useEffect(() => { void loadFromConfig(); }, [loadFromConfig]);

  // Hydrate SDUI store from persisted preview data so Run/Use-as-preview data survives refresh.
  // Migrate any legacy flat-UUID keys (stored before the collections.UUID convention) on the fly.
  useEffect(() => {
    const persisted = restorePreviewData();
    if (Object.keys(persisted).length === 0) return;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const setData = useSduiStore.getState().setData;
    for (const [key, value] of Object.entries(persisted)) {
      const storeKey = UUID_RE.test(key) ? `collections.${key}` : key;
      setData(storeKey, value);
    }
  }, []);

  // __builderStore is exposed at module level in _store.ts for E2E tests

  /** Serialize current page + active theme overrides to localStorage then open preview. */
  const openPreview = useCallback(() => {
    const { pageNodes, viewport, pages, currentPageId, themeOverrides, themeDarkOverrides, pageWorkflows, pageWorkflowMeta, globalWorkflows, globalWorkflowMeta } = useBuilderStore.getState();
    const currentPage = pages.find(p => p.id === currentPageId);
    localStorage.setItem(BUILDER_PREVIEW_KEY, JSON.stringify({
      nodes: pageNodes,
      viewport,
      pageName: currentPage?.name ?? 'Untitled',
      pageRoute: currentPage?.route ?? '/',
      themeOverrides,
      themeDarkOverrides,
      // Workflow definitions must travel with the page so the engine can resolve
      // { action: uuid } references stored on each node.
      pageWorkflows,
      pageWorkflowMeta,
      globalWorkflows,
      globalWorkflowMeta,
    }));
    window.open('/dev/builder/preview', '_blank');
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey;
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select'
        || (document.activeElement as HTMLElement)?.isContentEditable === true;

      // Cmd+P → preview in new tab (before isInput guard so it always fires)
      if (isCmd && e.key === 'p') { e.preventDefault(); openPreview(); return; }

      // Alt mode
      if (e.key === 'Alt') {
        store.setAltMode(true);
        e.preventDefault();
        return;
      }

      if (isInput && !(e.key === 'Escape')) return;

      if (isCmd && e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); return; }
      if (isCmd && (e.key === 'z' && e.shiftKey || e.key === 'y')) { e.preventDefault(); store.redo(); return; }
      if (isCmd && e.key === 'c') { e.preventDefault(); store.copyToClipboard(); return; }
      if (isCmd && e.key === 'v') { e.preventDefault(); store.pasteFromClipboard(); return; }
      if (isCmd && e.key === 'd') { e.preventDefault(); store.duplicateNodes(store.selectedIds); return; }
      if (isCmd && e.key === 'g') { e.preventDefault(); store.groupNodes(store.selectedIds); return; }
      if (isCmd && e.key === 'a') { e.preventDefault(); store.selectAll(); return; }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        e.preventDefault();
        if (store.selectedIds.length) store.deleteNodes(store.selectedIds);
        return;
      }

      if (e.key === 'Escape') {
        if (store.selectedIds.length > 0) store.selectParent(store.selectedIds[0]);
        else store.select(null);
        return;
      }
      if (e.key === 'Enter' && store.selectedIds.length > 0) {
        store.selectFirstChild(store.selectedIds[0]);
        return;
      }
      if ((e.key === 'v' || e.key === 'V') && !isCmd) { store.setTool('select'); return; }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') store.setAltMode(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [store, openPreview]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#0f172a',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <TopBar onPreview={openPreview} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <PanelLeft
          dataSlideState={leftSlide?.kind === 'data' ? leftSlide.subState : null}
          onSetDataSlide={s => {
            // Reset width to default when switching to a non-datasource slide (e.g. variable)
            if (!s || s.kind !== 'dataSource') setLeftSlideWidth(320);
            setLeftSlide(s ? { kind: 'data', subState: s } : null);
          }}
          logicSlideState={leftSlide?.kind === 'logic' ? leftSlide.subState : null}
          onSetLogicSlide={s => { setLeftSlideWidth(320); setLeftSlide(s ? { kind: 'logic', subState: s } : null); }}
          onOpenPageConfig={() => { setLeftSlideWidth(320); setLeftSlide({ kind: 'pageConfig' }); }}
          onWidthChange={setLeftSlideWidth}
        />

        {/* Left SlidePanel — slides in between left panel and canvas */}
        {leftSlide && (
          <SlidePanel
            title={(() => {
              if (leftSlide.kind === 'data' && leftSlide.subState?.kind === 'dataSource') {
                const id = leftSlide.subState.editingId;
                if (!id) return 'New Data Source';
                const ds = store.pageDataSources.find(s => s.id === id);
                if (!ds) return 'Data Source';
                const typeLabel = ds.type === 'graphql' ? 'GraphQL' : 'REST';
                const dsDisplayName = (ds as { _label?: string })._label ?? ds.name ?? ds.id;
                return `${dsDisplayName} · ${typeLabel}`;
              }
              return leftSlideTitle(leftSlide);
            })()}
            side="left"
            onClose={() => { setLeftSlide(null); setLeftSlideWidth(320); }}
            width={leftSlideWidth}
            testId="left-slide-panel"
          >
            {leftSlide.kind === 'data' && (
              <DataSlidePanelContent
                slideState={leftSlide.subState}
                onClose={() => { setLeftSlide(null); setLeftSlideWidth(320); }}
                onWidthChange={setLeftSlideWidth}
              />
            )}
            {leftSlide.kind === 'logic' && (
              <LogicSlidePanelContent
                slideState={leftSlide.subState}
                onClose={() => { setLeftSlide(null); setLeftSlideWidth(320); }}
              />
            )}
            {leftSlide.kind === 'pageConfig' && (
              <PageConfigSlidePanelContent onClose={() => { setLeftSlide(null); setLeftSlideWidth(320); }} />
            )}
          </SlidePanel>
        )}

        <BuilderCanvas />
        <PanelRight />
      </div>

      {/* Workflow canvas overlay — full-screen, mounts above everything */}
      {workflowCanvasTarget && (
        <WorkflowCanvas
          target={workflowCanvasTarget}
          onClose={closeWorkflowCanvas}
        />
      )}
    </div>
  );
}
