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

import { useEffect, useRef, useState, useCallback, startTransition } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';

/**
 * Extract the builder projectId from the URL.
 *
 * Two cases:
 *  1. /builder/<id>  — the protected platform route; middleware rewrites it to
 *     /dev/builder?projectId=<id> internally, but the BROWSER URL still shows
 *     /builder/<id>. useSearchParams() reads the browser URL, so it returns
 *     null for projectId. We must parse the path instead.
 *  2. /dev/builder?projectId=<id>  — legacy direct access / admin mode.
 *     useSearchParams() works correctly here.
 */
function useProjectId(): string | null {
  const searchParams = useSearchParams();
  const pathname = usePathname() ?? '';
  const fromSearch = searchParams.get('projectId');
  const fromPath = pathname.startsWith('/builder/')
    ? (pathname.split('/')[2] ?? null)
    : null;
  return fromSearch ?? fromPath;
}
import { useBuilderStore, restorePreviewData, VIEWPORT_WIDTHS, type ViewportSize } from './_store';
import { useSduiStore } from '@/store/sdui-store';
import type { BuilderPage } from './_store';
import BuilderCanvas from './_canvas';
import PanelLeft, { PageConfigSlidePanelContent, AuthSettingsSlidePanelContent } from './_panel-left';
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
import { useBuilderAutosave, type SaveStatus } from '@/lib/builder/autosave';
import { useShallow } from 'zustand/react/shallow';

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
  const { pages, currentPageId, addPage, navigatePage, renamePage, removePage } = useBuilderStore(
    useShallow(s => ({
      pages: s.pages, currentPageId: s.currentPageId,
      addPage: s.addPage, navigatePage: s.navigatePage,
      renamePage: s.renamePage, removePage: s.removePage,
    }))
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [customRoute, setCustomRoute] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const projectId = useProjectId();
  // APP ROUTES (from static config) are only relevant in admin/dev mode.
  // Real backend projects start blank and use custom routes only.
  const isAdminMode = !projectId || projectId === 'admin';

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
    if (renamingId) renamePage(renamingId, renameValue);
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
                  {!isRenaming && (
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
                {/* App routes — only shown in admin/dev mode (static config routes) */}
                {isAdminMode && (
                  <>
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
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── URL Parameters Popover ──────────────────────────────────────────────────

type QueryParam = { name: string; value: string };

function URLParamsPopover() {
  const { pages, currentPageId, setCurrentPageQueryParams } = useBuilderStore(
    useShallow(s => ({
      pages: s.pages,
      currentPageId: s.currentPageId,
      setCurrentPageQueryParams: s.setCurrentPageQueryParams,
    }))
  );

  const currentPage = pages.find(p => p.id === currentPageId);
  const savedParams = currentPage?.queryParams ?? [];

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<QueryParam[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync draft from store when opening
  useEffect(() => {
    if (open) {
      setDraft(savedParams.length > 0 ? savedParams.map(p => ({ ...p })) : []);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const updateParam = (idx: number, field: 'name' | 'value', val: string) => {
    setDraft(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  };

  const removeParam = (idx: number) => {
    setDraft(prev => prev.filter((_, i) => i !== idx));
  };

  const addParam = () => {
    setDraft(prev => [...prev, { name: '', value: '' }]);
  };

  const handleSave = () => {
    const cleaned = draft.filter(p => p.name.trim());
    setCurrentPageQueryParams(cleaned);
    setOpen(false);
  };

  const handleReset = () => {
    setDraft([]);
  };

  // Build URL preview from draft params
  const paramCount = savedParams.filter(p => p.name.trim()).length;
  const previewUrl = (() => {
    const validParams = draft.filter(p => p.name.trim());
    if (validParams.length === 0) return 'https://yourdomain.com/';
    const qs = validParams.map(p => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join('&');
    return `https://yourdomain.com/${currentPage?.route ? currentPage.route.replace(/^\//, '') : ''}?${qs}`;
  })();

  return (
    <div ref={containerRef} style={{ position: 'relative' }} data-testid="url-params-popover">
      {/* Trigger button */}
      <button
        data-testid="url-params-trigger"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px',
          background: open ? '#1f2937' : 'transparent',
          border: `1px solid ${open ? '#3b82f6' : '#374151'}`,
          borderRadius: 6,
          color: '#d1d5db',
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'system-ui',
          fontWeight: 500,
          transition: 'all 0.15s',
        }}
      >
        <span style={{ fontSize: 11, opacity: 0.8 }}>(x)</span>
        <span>URL Parameters</span>
        {paramCount > 0 && (
          <span style={{
            background: '#3b82f6',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            borderRadius: 10,
            padding: '1px 5px',
            minWidth: 16,
            textAlign: 'center',
            lineHeight: '14px',
          }}>
            {paramCount}
          </span>
        )}
      </button>

      {/* Popover dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: 520,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 10,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            zIndex: 99999,
            fontFamily: 'system-ui',
            overflow: 'hidden',
          }}
        >
          {/* URL Preview */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #334155' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>URL Preview</div>
            <div style={{
              fontSize: 11,
              color: '#94a3b8',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}>
              {previewUrl}
            </div>
          </div>

          {/* Query parameters */}
          <div style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#e2e8f0',
                border: '1px solid #475569',
                borderRadius: 6,
                padding: '4px 10px',
                background: '#0f172a',
              }}>
                Query parameters
              </div>
              <span
                title="Define query parameters that are accessible in formulas via globalContext.browser.query"
                style={{ cursor: 'help', fontSize: 14, color: '#6b7280' }}
              >
                ⓘ
              </span>
            </div>

            {/* Column headers */}
            {draft.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 6, paddingRight: 30 }}>
                <div style={{ flex: 1, fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</div>
                <div style={{ flex: 1, fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current value</div>
              </div>
            )}

            {/* Param rows */}
            {draft.map((param, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <input
                  data-testid={`url-param-name-${idx}`}
                  value={param.name}
                  onChange={e => updateParam(idx, 'name', e.target.value)}
                  placeholder="Name"
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: 6,
                    color: '#e2e8f0',
                    fontSize: 12,
                    fontFamily: 'system-ui',
                    outline: 'none',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#334155')}
                />
                <input
                  data-testid={`url-param-value-${idx}`}
                  value={param.value}
                  onChange={e => updateParam(idx, 'value', e.target.value)}
                  placeholder="Value"
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: 6,
                    color: '#e2e8f0',
                    fontSize: 12,
                    fontFamily: 'system-ui',
                    outline: 'none',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#334155')}
                />
                <button
                  data-testid={`url-param-remove-${idx}`}
                  onClick={() => removeParam(idx)}
                  title="Remove parameter"
                  style={{
                    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#6b7280', fontSize: 14, borderRadius: 4,
                    flexShrink: 0,
                    transition: 'color 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
                >
                  ✕
                </button>
              </div>
            ))}

            {/* Add parameter button */}
            <button
              data-testid="url-param-add"
              onClick={addParam}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 0',
                background: 'none', border: 'none',
                color: '#3b82f6', fontSize: 12, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'system-ui',
                transition: 'color 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#60a5fa')}
              onMouseLeave={e => (e.currentTarget.style.color = '#3b82f6')}
            >
              + Add query parameter
            </button>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '10px 16px',
            borderTop: '1px solid #334155',
          }}>
            <button
              data-testid="url-params-reset"
              onClick={handleReset}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 12px',
                background: 'none',
                border: '1px solid #475569',
                borderRadius: 6,
                color: '#94a3b8',
                fontSize: 11, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'system-ui',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#6b7280'; e.currentTarget.style.color = '#d1d5db'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.color = '#94a3b8'; }}
            >
              ↻ Reset
            </button>
            <button
              data-testid="url-params-save"
              onClick={handleSave}
              style={{
                padding: '5px 16px',
                background: '#7c3aed',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                fontSize: 11, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'system-ui',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#6d28d9')}
              onMouseLeave={e => (e.currentTarget.style.background = '#7c3aed')}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SaveStatusBadge({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  const config: Record<SaveStatus, { label: string; color: string }> = {
    idle:   { label: '',          color: 'transparent' },
    saving: { label: 'Saving…',   color: '#6b7280' },
    saved:  { label: '✓ Saved',   color: '#10b981' },
    error:  { label: '⚠ Save failed', color: '#ef4444' },
  };
  const { label, color } = config[status];
  return (
    <span style={{ fontSize: 10, color, fontFamily: 'system-ui', transition: 'color 0.3s' }}>
      {label}
    </span>
  );
}

function TopBar({
  onPreview,
  onSeed,
  saveStatus,
  projectId,
}: {
  onPreview: () => void | Promise<void>;
  onSeed: () => Promise<void>;
  saveStatus: SaveStatus;
  projectId: string | null;
}) {
  const { undo, redo, historyIdx, history, selectedIds, pageNodes, viewport, setViewport, pages, currentPageId, aiMode, toggleAiMode } = useBuilderStore(
    useShallow(s => ({
      undo: s.undo, redo: s.redo, historyIdx: s.historyIdx, history: s.history,
      selectedIds: s.selectedIds, pageNodes: s.pageNodes, viewport: s.viewport,
      setViewport: s.setViewport, pages: s.pages, currentPageId: s.currentPageId,
      aiMode: s.aiMode, toggleAiMode: s.toggleAiMode,
    }))
  );
  const canUndo = historyIdx > 0;
  const canRedo = historyIdx < history.length - 1;
  const currentPageForPreview = pages.find(p => p.id === currentPageId);
  const canPreview = !!currentPageForPreview?.route;
  const previewTooltip = !currentPageId || pages.length === 0
    ? 'Add a page to enable preview'
    : !currentPageForPreview?.route
      ? 'This page has no app route — select a routed page to preview'
      : 'Preview in new tab (⌘P)';
  const [menuOpen, setMenuOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

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
      {/* Back to workspace link (only when opened from a project) */}
      {projectId && (
        <a
          href="/workspaces"
          title="Back to workspaces"
          style={{
            display: 'flex', alignItems: 'center',
            fontSize: 10, color: '#6b7280',
            textDecoration: 'none',
            padding: '2px 6px',
            borderRadius: 4,
            fontFamily: 'system-ui',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#9ca3af')}
          onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
        >
          ← Projects
        </a>
      )}

      <div style={{ width: 1, height: 20, background: '#1f2937' }} />

      {/* History */}
      <TopBarBtn disabled={!canUndo} onClick={undo} title="Undo (⌘Z)"   testId="btn-undo">↩</TopBarBtn>
      <TopBarBtn disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)" testId="btn-redo">↪</TopBarBtn>

      <div style={{ width: 1, height: 20, background: '#1f2937' }} />

      {/* Pages picker dropdown (replaces the static page name in the centre) */}
      <PagesPicker />

      {/* URL query parameter definitions for the current page */}
      <URLParamsPopover />

      <div style={{ flex: 1 }} />

      {/* ── Responsive viewport breakpoints ── */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {(Object.keys(VIEWPORT_WIDTHS) as ViewportSize[]).map(v => (
          <button
            key={v}
            data-testid={`viewport-${v}`}
            onClick={() => startTransition(() => setViewport(v))}
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

      {/* AI Assistant toggle */}
      <button
        data-testid="btn-ai-mode"
        onClick={toggleAiMode}
        title={aiMode ? 'Close AI Assistant' : 'Open AI Assistant'}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px',
          background: aiMode ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : '#1e293b',
          border: `1px solid ${aiMode ? '#7c3aed' : '#334155'}`,
          borderRadius: 5,
          color: aiMode ? '#fff' : '#94a3b8',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'system-ui',
          letterSpacing: '0.02em',
          transition: 'all 0.15s',
        }}
      >
        ✦ AI
      </button>

      {/* Preview button — opens preview subdomain at the selected page route */}
      <button
        data-testid="btn-preview"
        onClick={canPreview ? onPreview : undefined}
        disabled={!canPreview}
        title={previewTooltip}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 12px',
          background: canPreview ? '#10b981' : '#374151',
          border: 'none',
          borderRadius: 5,
          color: canPreview ? '#fff' : '#6b7280',
          cursor: canPreview ? 'pointer' : 'not-allowed',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'system-ui',
          letterSpacing: '0.02em',
          opacity: canPreview ? 1 : 0.6,
          transition: 'background 0.15s, color 0.15s, opacity 0.15s',
        }}
      >
        ↗ Preview
      </button>

      <div style={{ width: 1, height: 20, background: '#1f2937' }} />

      {/* Autosave status */}
      <SaveStatusBadge status={saveStatus} />

      {/* Node count */}
      <span style={{ fontSize: 10, color: '#4b5563' }}>
        {pageNodes.length} section{pageNodes.length !== 1 ? 's' : ''}
      </span>

      {selectedIds.length > 0 && (
        <span style={{ fontSize: 10, color: '#3b82f6' }}>
          · {selectedIds.length} selected
        </span>
      )}

      {/* ⋮ project menu — only shown when a project is open */}
      {projectId && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            title="Project options"
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: menuOpen ? '#1f2937' : 'transparent',
              border: 'none', borderRadius: 5, cursor: 'pointer',
              color: '#6b7280', fontSize: 16, fontFamily: 'system-ui',
              transition: 'background 120ms',
            }}
            onMouseEnter={e => { if (!menuOpen) (e.currentTarget as HTMLButtonElement).style.background = '#1f2937'; }}
            onMouseLeave={e => { if (!menuOpen) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            ⋮
          </button>

          {menuOpen && (
            <>
              {/* Click-outside backdrop */}
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                onClick={() => setMenuOpen(false)}
              />
              {/* Dropdown */}
              <div style={{
                position: 'absolute', right: 0, top: 32, zIndex: 50,
                width: 200, background: '#1e293b',
                border: '1px solid #334155', borderRadius: 8,
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                overflow: 'hidden', fontFamily: 'system-ui',
              }}>
                {/* Section label */}
                <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Project
                </div>

                {/* Seed from template */}
                <button
                  disabled={seeding}
                  onClick={async () => {
                    setMenuOpen(false);
                    if (!confirm('This will replace ALL current content with the default template config.\n\nContinue?')) return;
                    setSeeding(true);
                    try {
                      await onSeed();
                    } finally {
                      setSeeding(false);
                    }
                  }}
                  style={{
                    width: '100%', padding: '9px 12px', textAlign: 'left',
                    background: 'none', border: 'none', cursor: seeding ? 'not-allowed' : 'pointer',
                    fontSize: 12.5, color: seeding ? '#475569' : '#e2e8f0',
                    display: 'flex', alignItems: 'center', gap: 8,
                    opacity: seeding ? 0.6 : 1,
                    transition: 'background 100ms',
                  }}
                  onMouseEnter={e => { if (!seeding) (e.currentTarget as HTMLButtonElement).style.background = '#0f172a'; }}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                >
                  {seeding ? (
                    <>
                      <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      Seeding…
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 14 }}>🌱</span>
                      Seed from template
                    </>
                  )}
                </button>

                <div style={{ height: 1, background: '#334155', margin: '4px 0' }} />

                {/* Open preview */}
                <button
                  disabled={!canPreview}
                  onClick={() => { if (!canPreview) return; setMenuOpen(false); void onPreview(); }}
                  style={{
                    width: '100%', padding: '9px 12px', textAlign: 'left',
                    background: 'none', border: 'none', cursor: canPreview ? 'pointer' : 'not-allowed',
                    fontSize: 12.5, color: canPreview ? '#e2e8f0' : '#4b5563',
                    display: 'flex', alignItems: 'center', gap: 8,
                    transition: 'background 100ms',
                  }}
                  onMouseEnter={e => { if (canPreview) (e.currentTarget as HTMLButtonElement).style.background = '#0f172a'; }}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'none'}
                >
                  <span style={{ fontSize: 14 }}>↗</span>
                  Open preview
                </button>
              </div>
            </>
          )}
        </div>
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
  | { kind: 'authConfig' }
  | null;

function leftSlideTitle(state: LeftSlideState): string {
  if (!state) return '';
  if (state.kind === 'data') return getDataSlideTitle(state.subState);
  if (state.kind === 'logic') return getLogicSlideTitle(state.subState);
  if (state.kind === 'pageConfig') return 'Page Settings';
  if (state.kind === 'authConfig') return 'Auth Settings';
  return '';
}

export default function BuilderPage() {
  const initTheme = useBuilderStore(s => s.initTheme);
  const loadFromConfig = useBuilderStore(s => s.loadFromConfig);
  const setProjectContext = useBuilderStore(s => s.setProjectContext);
  const setAiPendingMessage = useBuilderStore(s => s.setAiPendingMessage);
  const toggleAiMode = useBuilderStore(s => s.toggleAiMode);
  const aiMode = useBuilderStore(s => s.aiMode);
  const workflowCanvasTarget = useBuilderStore(s => s.workflowCanvasTarget);
  const closeWorkflowCanvas = useBuilderStore(s => s.closeWorkflowCanvas);
  const [leftSlide, setLeftSlide] = useState<LeftSlideState>(null);
  const [leftSlideWidth, setLeftSlideWidth] = useState(320);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  // True while loadFromConfig is in-flight — shows a full-screen loader so the
  // user never sees an empty canvas flash while the project config is loading.
  const [configLoading, setConfigLoading] = useState(true);

  // Wizard AI build mode — ?ai=build triggers chat auto-send after config loads
  const searchParams = useSearchParams();
  const aiBuildMode = searchParams.get('ai') === 'build';

  // Persistent reference to the dev-preview window so we can reuse it and send
  // updated config via postMessage without reopening a new tab on every click.
  const previewWinRef = useRef<Window | null>(null);

  const projectId = useProjectId();

  // Install Gluestack primary token bridge immediately on mount so Checkbox,
  // Radio, Switch etc. reflect --primary even before a preset is applied.
  useEffect(() => { initTheme(); }, [initTheme]);

  // Autosave: debounced 1-second save to backend whenever store state changes.
  // seedAutosaveBaseline must be called once after the initial backend load so
  // that the autosave snapshots match the loaded state and no bogus save fires.
  const seedAutosaveBaseline = useBuilderAutosave(projectId, setSaveStatus);

  // Load config from backend (real projectId) or static config (admin / no id).
  // After the async load settles, seed the autosave baseline so it doesn't
  // treat the freshly-loaded state as "dirty" and immediately save it back.
  useEffect(() => {
    void loadFromConfig(projectId ?? undefined).then(() => {
      if (projectId && projectId !== 'admin') {
        seedAutosaveBaseline(useBuilderStore.getState());
      }
      setConfigLoading(false);

      // If wizard triggered AI build mode, open chat and auto-send the build request
      if (aiBuildMode && projectId) {
        const stored = localStorage.getItem(`ai_wizard_result_${projectId}`);
        if (stored) {
          try {
            const wizardResult = JSON.parse(stored) as {
              appName: string;
              businessDescription: string;
              category: string;
              mood: string;
              animationLevel: number;
              layoutStructure: number;
              selectedPages: Array<{ name: string; sections: Array<{ name: string; description?: string }> }>;
            };
            // Save wizard context so the AI always has it in every message
            setProjectContext({
              mood:           wizardResult.mood,
              animationLevel: wizardResult.animationLevel,
              description:    wizardResult.businessDescription,
              appName:        wizardResult.appName,
              category:       wizardResult.category,
            });
            // Build a focused prompt — business context is already in the AI system prompt
            const sections = wizardResult.selectedPages.flatMap(p =>
              p.sections.map(s => `  - [${p.name}] ${s.name}${s.description ? `: ${s.description}` : ''}`)
            ).join('\n');
            const msg =
              `Build the app using the project context you already have.\n\n` +
              `Pages and sections to build:\n${sections}\n\n` +
              `Build each section step by step. Start with the first page and work through all sections.`;
            setAiPendingMessage(msg);
            // Open the chat panel (aiMode controls right panel showing chat)
            if (!aiMode) toggleAiMode();
            // Clean up
            localStorage.removeItem(`ai_wizard_result_${projectId}`);
            const url = new URL(window.location.href);
            url.searchParams.delete('ai');
            window.history.replaceState({}, '', url.toString());
          } catch (e) {
            console.error('[builder] Failed to parse wizard result:', e);
          }
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFromConfig, projectId, seedAutosaveBaseline]);

  // Emergency save on tab close / refresh — uses keepalive fetch so the request
  // survives the page unload even if the JS runtime shuts down.
  useEffect(() => {
    if (!projectId) return;
    const handler = () => {
      const s = useBuilderStore.getState();
      const pagesWithLive = s.pages.map(p =>
        p.id === s.currentPageId ? { ...p, nodes: s.pageNodes } : p
      );
      // Import synchronously via the already-loaded module (not dynamic import)
      import('@/lib/builder/autosave').then(({ serializeBuilderState }) => {
        const config = serializeBuilderState({ ...s, pages: pagesWithLive });
        fetch(`/api/projects/${projectId}/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
          credentials: 'include',
          keepalive: true,
        }).catch(() => {/* best-effort */});
      }).catch(() => {/* module not loaded yet */});
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [projectId]);

  /**
   * Seed the project with all screens / actions / variables / data sources
   * from config/root.ts.  Saves to the backend then reloads the store so
   * the builder shows the seeded content coming from the backend.
   */
  const handleSeed = useCallback(async () => {
    if (!projectId) return;
    setSaveStatus('saving');
    try {
      const { buildSeedConfig } = await import('@/lib/builder/seed-from-config');
      const seedData = buildSeedConfig();

      const res = await fetch(`/api/projects/${projectId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedData),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStatus('saved');

      // Reload builder state from the freshly saved backend config.
      await loadFromConfig(projectId);
      seedAutosaveBaseline(useBuilderStore.getState());
    } catch (err) {
      console.error('[builder] Seed failed:', err);
      setSaveStatus('error');
    }
  }, [projectId, loadFromConfig, seedAutosaveBaseline, setSaveStatus]);

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

  /**
   * Open preview.
   *
   * When the builder is opened with ?projectId=xxx (from the workspace):
   *   1. Force-save the current state to the backend immediately (don't wait for debounce).
   *   2. Open http://{projectId}.{baseHost}{pageRoute} in a new tab.
   *      Each project gets its own subdomain origin → localStorage is isolated
   *      per project automatically. No projectId query param needed.
   *
   * When there is no projectId (builder-dev mode, static config):
   *   Open preview-dev.localhost at the current page route — serves the same
   *   static config/app.ts without any auth or backend dependency.
   */
  const openPreview = useCallback(async () => {
    const { pageNodes, viewport, pages, currentPageId, themeOverrides, themeDarkOverrides, pageWorkflows, pageWorkflowMeta, globalWorkflows, globalWorkflowMeta, customVars } = useBuilderStore.getState();
    const currentPage = pages.find(p => p.id === currentPageId);

    // Always save to localStorage so the standalone preview (/dev/builder/preview) still works
    localStorage.setItem(BUILDER_PREVIEW_KEY, JSON.stringify({
      nodes: pageNodes,
      viewport,
      pageName: currentPage?.name ?? 'Untitled',
      pageRoute: currentPage?.route ?? '/',
      themeOverrides,
      themeDarkOverrides,
      pageWorkflows,
      pageWorkflowMeta,
      globalWorkflows,
      globalWorkflowMeta,
      customVars,
    }));

    if (projectId) {
      // Open a blank window IMMEDIATELY while the user-gesture token is still
      // active. Browsers expire popup permission after the first await, so any
      // window.open() call that comes after an await silently navigates the
      // current tab (destroying its history) instead of opening a new one.
      //
      // URL: {projectId}.{baseHost}{pageRoute}
      // Each project has its own subdomain origin — localStorage is isolated
      // without any code-level namespacing.
      const baseHost = window.location.host
        .replace(/^builder-dev\./, '')
        .replace(/^preview\./, '');
      const pageRoute = currentPage?.route ?? '/';
      const previewWin = window.open('about:blank', 'sdui-preview');

      // Force-save current state to backend immediately (bypasses debounce).
      // Sync live pageNodes back into pages first so unsaved edits aren't lost.
      try {
        const { serializeBuilderState } = await import('@/lib/builder/autosave');
        const s = useBuilderStore.getState();
        // Build a pages array that has the current live pageNodes for the active page
        const pagesWithLiveNodes = s.pages.map(p =>
          p.id === s.currentPageId ? { ...p, nodes: s.pageNodes } : p
        );
        const config = serializeBuilderState({ ...s, pages: pagesWithLiveNodes });
        setSaveStatus('saving');
        const res = await fetch(`/api/projects/${projectId}/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }

      // Fetch a short-lived preview token so the preview subdomain can call
      // /api/projects/:id/config without the auth cookie (which is bound to
      // the main domain and not sent by the project subdomain).
      let previewToken = '';
      try {
        const tokenRes = await fetch(`/api/projects/${projectId}/preview-token`, {
          method: 'POST',
          credentials: 'include',
        });
        if (tokenRes.ok) {
          const { token } = await tokenRes.json() as { token: string };
          previewToken = token;
        }
      } catch {
        // Non-fatal — preview may still work if cookie is present
      }

      // Navigate to the project-specific subdomain.
      // The middleware detects the {projectId}.* subdomain pattern and sets
      // the preview_project_id cookie automatically — no query param needed.
      let previewUrl = `${window.location.protocol}//${projectId}.${baseHost}${pageRoute}`;
      if (previewToken) {
        previewUrl += `?token=${encodeURIComponent(previewToken)}`;
      }
      if (previewWin) {
        previewWin.location.href = previewUrl;
      } else {
        // Popup was blocked — nothing we can do, the user must allow popups
        setSaveStatus('error');
      }
    } else {
      // No projectId (builder-dev mode) — open preview-dev at the current page
      // route. Config is sent via postMessage so localStorage isolation between
      // subdomains is not an issue.
      const pageRoute = currentPage?.route ?? '/';
      const baseHost = window.location.host.replace(/^builder-dev\./, '');
      const previewUrl = `${window.location.protocol}//preview-dev.${baseHost}${pageRoute}`;

      const configPayload = JSON.parse(localStorage.getItem(BUILDER_PREVIEW_KEY) ?? '{}');
      const msg = { type: 'BUILDER_LIVE_CONFIG', config: configPayload };

      const sendToPreview = () => previewWinRef.current?.postMessage(msg, '*');

      if (!previewWinRef.current || previewWinRef.current.closed) {
        previewWinRef.current = window.open(previewUrl, 'sdui-dev-preview') ?? null;
      } else {
        // Reuse existing tab — navigate to new route
        previewWinRef.current.location.href = previewUrl;
        sendToPreview();
      }

      // Listen for PREVIEW_READY signal (new window signals when it's mounted)
      const onReady = (e: MessageEvent) => {
        if (e.data?.type === 'PREVIEW_READY') {
          sendToPreview();
          window.removeEventListener('message', onReady);
        }
      };
      window.addEventListener('message', onReady);

      // Fallback retries in case the READY signal arrives before we add the listener
      setTimeout(sendToPreview, 400);
      setTimeout(sendToPreview, 1000);
    }
  }, [projectId, setSaveStatus]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Suppress all builder shortcuts while any overlay is active — the overlay
      // registers its own window keydown handler and should own the keyboard entirely.
      if (useBuilderStore.getState().workflowCanvasTarget) return;

      const isCmd = e.metaKey || e.ctrlKey;
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select'
        || (document.activeElement as HTMLElement)?.isContentEditable === true;

      // Cmd+P → preview in new tab (only when a page is selected)
      if (isCmd && e.key === 'p') {
        e.preventDefault();
        const { pages: ps, currentPageId: cpId } = useBuilderStore.getState();
        if (ps.length > 0 && cpId) void openPreview();
        return;
      }

      // Alt mode
      if (e.key === 'Alt') {
        useBuilderStore.getState().setAltMode(true);
        e.preventDefault();
        return;
      }

      if (isInput && !(e.key === 'Escape')) return;

      const s = useBuilderStore.getState();
      if (isCmd && e.key === 'z' && !e.shiftKey) { e.preventDefault(); s.undo(); return; }
      if (isCmd && (e.key === 'z' && e.shiftKey || e.key === 'y')) { e.preventDefault(); s.redo(); return; }
      if (isCmd && e.key === 'c') { e.preventDefault(); s.copyToClipboard(); return; }
      if (isCmd && e.key === 'v') { e.preventDefault(); s.pasteFromClipboard(); return; }
      if (isCmd && e.key === 'd') { e.preventDefault(); s.duplicateNodes(s.selectedIds); return; }
      if (isCmd && e.key === 'g') { e.preventDefault(); s.groupNodes(s.selectedIds); return; }
      if (isCmd && e.key === 'a') { e.preventDefault(); s.selectAll(); return; }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        e.preventDefault();
        if (s.selectedIds.length) s.deleteNodes(s.selectedIds);
        return;
      }

      if (e.key === 'Escape') {
        if (s.selectedIds.length > 0) s.selectParent(s.selectedIds[0]);
        else s.select(null);
        return;
      }
      if (e.key === 'Enter' && s.selectedIds.length > 0) {
        s.selectFirstChild(s.selectedIds[0]);
        return;
      }
      if ((e.key === 'v' || e.key === 'V') && !isCmd) { s.setTool('select'); return; }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (useBuilderStore.getState().workflowCanvasTarget) return;
      if (e.key === 'Alt') useBuilderStore.getState().setAltMode(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [openPreview]);

  if (configLoading) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        width: '100vw', height: '100vh', background: '#0f172a',
        fontFamily: 'system-ui, -apple-system, sans-serif', gap: 20,
      }}>
        {/* Animated spinner */}
        <div style={{ position: 'relative', width: 48, height: 48 }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.08)',
          }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '3px solid transparent',
            borderTopColor: '#3b82f6',
            animation: 'spin 0.75s linear infinite',
          }} />
        </div>
        <div style={{ fontSize: 13, color: '#64748b', letterSpacing: '0.02em' }}>
          Loading project…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

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
      <TopBar onPreview={openPreview} onSeed={handleSeed} saveStatus={saveStatus} projectId={projectId} />

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
          onOpenAuthConfig={() => { setLeftSlideWidth(360); setLeftSlide({ kind: 'authConfig' }); }}
          onWidthChange={setLeftSlideWidth}
        />

        {/* Left SlidePanel — slides in between left panel and canvas */}
        {leftSlide && (
          <SlidePanel
            title={(() => {
              if (leftSlide.kind === 'data' && leftSlide.subState?.kind === 'dataSource') {
                const id = leftSlide.subState.editingId;
                if (!id) return 'New Data Source';
                const ds = useBuilderStore.getState().pageDataSources.find(s => s.id === id);
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
            {leftSlide.kind === 'authConfig' && (
              <AuthSettingsSlidePanelContent onClose={() => { setLeftSlide(null); setLeftSlideWidth(320); }} />
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
