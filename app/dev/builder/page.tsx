'use client';

export const dynamic = 'force-dynamic';

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
import { ExportModal } from './_export-modal';
import { projects as projectsApi, envVariables } from '@/lib/platform/api-client';
import EnvVarsPanel from './_env-vars-panel';
import { SlidePanel } from './_slide-panel';
import { CustomColorSlideContent } from './_custom-color-form';
import type { CustomColor } from './_store';
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
import { DataApiTab } from './_data-api-tab';

void useRef; void useState; // suppress unused-import lint

/** localStorage key used to hand off page data to the preview tab. */
export const BUILDER_PREVIEW_KEY = 'builder_preview';


// ─── Builder chrome theme toggle ──────────────────────────────────────────────

function BuilderThemeToggle() {
  const builderTheme = useBuilderStore(s => s.builderTheme);
  const toggleBuilderTheme = useBuilderStore(s => s.toggleBuilderTheme);
  const isDark = builderTheme === 'dark';

  return (
    <button
      onClick={toggleBuilderTheme}
      title={isDark ? 'Builder: Switch to Light' : 'Builder: Switch to Dark'}
      data-testid="btn-builder-theme"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28,
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 5,
        color: 'var(--bld-text-3)',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-3)'; }}
    >
      {isDark ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

// ─── App preview dark/light toggle ─────────────────────────────────────────────

function DarkModeToggle() {
  const [dark, setDark] = useState(false);

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
      title={dark ? 'Preview: Light mode' : 'Preview: Dark mode'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28,
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 5,
        color: 'var(--bld-text-3)',
        cursor: 'pointer',
        fontSize: 13,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-3)'; }}
    >
      {dark ? '☀' : '☽'}
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

function PagesPicker({ onOpenPageConfig }: { onOpenPageConfig: () => void }) {
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
          background: open ? 'var(--bld-bg-input)' : 'transparent',
          border: `1px solid ${open ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`,
          borderRadius: 6,
          color: 'var(--bld-text-2)',
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'system-ui',
          minWidth: 120,
          maxWidth: 220,
        }}
      >
        <span style={{ fontSize: 12, opacity: 0.7 }}>📄</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: 'var(--bld-text-1)' }}>
          {currentPage?.name ?? 'Select page'}
        </span>
        {currentPage?.route && (
          <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', fontFamily: 'monospace', flexShrink: 0 }}>
            {currentPage.route}
          </span>
        )}
        <span style={{ color: 'var(--bld-text-disabled)', fontSize: 9, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
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
            background: 'var(--bld-bg-panel)',
            border: '1px solid var(--bld-border-subtle)',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
            zIndex: 99999,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--bld-border)' }}>
            <input
              autoFocus
              placeholder="Search pages…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)',
                borderRadius: 5, color: 'var(--bld-text-2)', fontSize: 11, padding: '5px 8px',
                boxSizing: 'border-box', outline: 'none',
              }}
            />
          </div>

          {/* Page list */}
          <div style={{ overflowY: 'auto', maxHeight: 260 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--bld-text-3)', fontStyle: 'italic' }}>No pages match</div>
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
                    borderLeft: isActive ? '2px solid var(--bld-accent)' : '2px solid transparent',
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
                        style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-accent)', borderRadius: 3, color: 'var(--bld-text-1)', fontSize: 11, padding: '1px 5px', boxSizing: 'border-box' }}
                      />
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: isActive ? 'var(--bld-text-1)' : 'var(--bld-text-2)', fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          onDoubleClick={e => { e.stopPropagation(); setRenamingId(page.id); setRenameValue(page.name); }}>
                          {page.name}
                        </div>
                        {page.route && <div style={{ fontSize: 9, color: 'var(--bld-text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.route}</div>}
                      </>
                    )}
                  </div>
                  {!isRenaming && (
                    <>
                      <button
                        title="Page settings"
                        onClick={e => {
                          e.stopPropagation();
                          navigatePage(page.id);
                          setOpen(false);
                          onOpenPageConfig();
                        }}
                        style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 12, padding: '2px 4px', borderRadius: 3, flexShrink: 0, lineHeight: 1 }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-text-2)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                      </button>
                      <button title="Remove page" onClick={e => { e.stopPropagation(); removePage(page.id); }}
                        style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 13, padding: '2px 4px', borderRadius: 3, flexShrink: 0 }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-error)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}>×</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add page / route picker */}
          <div style={{ borderTop: '1px solid var(--bld-border)' }}>
            {!showAdd ? (
              <button
                data-testid="pages-picker-add"
                onClick={() => setShowAdd(true)}
                style={{
                  width: '100%', padding: '8px 12px', background: 'transparent', border: 'none',
                  color: 'var(--bld-text-disabled)', fontSize: 11, cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'system-ui',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-text-2)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
              >
                <span style={{ fontSize: 14 }}>+</span> Add page
              </button>
            ) : (
              <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Custom route */}
                <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', letterSpacing: '0.04em' }}>CUSTOM ROUTE</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input autoFocus placeholder="/my-page" value={customRoute}
                    onChange={e => setCustomRoute(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCustom(); if (e.key === 'Escape') setShowAdd(false); e.stopPropagation(); }}
                    style={{ flex: 1, background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '4px 8px', outline: 'none', fontFamily: 'monospace' }}
                  />
                  <button onClick={handleAddCustom} disabled={!customRoute.trim()}
                    style={{ padding: '4px 10px', background: customRoute.trim() ? 'var(--bld-accent-hover)' : 'var(--bld-bg-elevated)', border: 'none', borderRadius: 4, color: customRoute.trim() ? '#fff' : 'var(--bld-text-disabled)', fontSize: 11, cursor: customRoute.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
                    Add
                  </button>
                </div>
                {/* App routes — only shown in admin/dev mode (static config routes) */}
                {isAdminMode && (
                  <>
                    <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', letterSpacing: '0.04em', marginTop: 4 }}>APP ROUTES</div>
                    <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                      {allRoutes.map(r => {
                        const alreadyAdded = pages.some((p: BuilderPage) => p.route === r.path);
                        return (
                          <button key={r.config} disabled={alreadyAdded}
                            onClick={() => { if (!alreadyAdded) { addPage(r.path, r.config); setShowAdd(false); setOpen(false); } }}
                            style={{ display: 'flex', width: '100%', alignItems: 'baseline', gap: 6, padding: '5px 4px', background: 'none', border: 'none', color: alreadyAdded ? 'var(--bld-text-disabled)' : 'var(--bld-text-2)', fontSize: 11, textAlign: 'left', cursor: alreadyAdded ? 'default' : 'pointer' }}
                            onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; }}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                            <span style={{ fontFamily: 'monospace', fontSize: 10, color: alreadyAdded ? 'var(--bld-border-subtle)' : 'var(--bld-info)', flexShrink: 0 }}>{r.path}</span>
                            <span style={{ opacity: alreadyAdded ? 0.35 : 0.6 }}>{r.config}</span>
                            {alreadyAdded && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--bld-text-disabled)' }}>✓</span>}
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
          background: open ? 'var(--bld-bg-input)' : 'transparent',
          border: `1px solid ${open ? 'var(--bld-accent)' : 'var(--bld-border-subtle)'}`,
          borderRadius: 6,
          color: 'var(--bld-text-2)',
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
            background: 'var(--bld-accent)',
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
            background: 'var(--bld-bg-elevated)',
            border: '1px solid var(--bld-border-subtle)',
            borderRadius: 10,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            zIndex: 99999,
            fontFamily: 'system-ui',
            overflow: 'hidden',
          }}
        >
          {/* URL Preview */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--bld-border-subtle)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--bld-text-1)', marginBottom: 4 }}>URL Preview</div>
            <div style={{
              fontSize: 11,
              color: 'var(--bld-text-3)',
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
                color: 'var(--bld-text-1)',
                border: '1px solid #475569',
                borderRadius: 6,
                padding: '4px 10px',
                background: 'var(--bld-bg-base)',
              }}>
                Query parameters
              </div>
              <span
                title="Define query parameters that are accessible in formulas via globalContext.browser.query"
                style={{ cursor: 'help', fontSize: 14, color: 'var(--bld-text-disabled)' }}
              >
                ⓘ
              </span>
            </div>

            {/* Column headers */}
            {draft.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 6, paddingRight: 30 }}>
                <div style={{ flex: 1, fontSize: 10, fontWeight: 600, color: 'var(--bld-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</div>
                <div style={{ flex: 1, fontSize: 10, fontWeight: 600, color: 'var(--bld-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current value</div>
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
                    background: 'var(--bld-bg-base)',
                    border: '1px solid var(--bld-border-subtle)',
                    borderRadius: 6,
                    color: 'var(--bld-text-1)',
                    fontSize: 12,
                    fontFamily: 'system-ui',
                    outline: 'none',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
                />
                <input
                  data-testid={`url-param-value-${idx}`}
                  value={param.value}
                  onChange={e => updateParam(idx, 'value', e.target.value)}
                  placeholder="Value"
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    background: 'var(--bld-bg-base)',
                    border: '1px solid var(--bld-border-subtle)',
                    borderRadius: 6,
                    color: 'var(--bld-text-1)',
                    fontSize: 12,
                    fontFamily: 'system-ui',
                    outline: 'none',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
                />
                <button
                  data-testid={`url-param-remove-${idx}`}
                  onClick={() => removeParam(idx)}
                  title="Remove parameter"
                  style={{
                    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--bld-text-disabled)', fontSize: 14, borderRadius: 4,
                    flexShrink: 0,
                    transition: 'color 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
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
                color: 'var(--bld-accent)', fontSize: 12, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'system-ui',
                transition: 'color 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-info)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-accent)')}
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
                color: 'var(--bld-text-3)',
                fontSize: 11, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'system-ui',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--bld-text-disabled)'; e.currentTarget.style.color = 'var(--bld-text-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bld-border-subtle)'; e.currentTarget.style.color = 'var(--bld-text-3)'; }}
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
    saving: { label: 'Saving…',   color: 'var(--bld-text-disabled)' },
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
  saveStatus,
  projectId,
  mainMode,
  onMainModeChange,
  leftTab,
  onSetLeftTab,
  onOpenAuthConfig,
  onOpenPageConfig,
}: {
  onPreview: () => void | Promise<void>;
  saveStatus: SaveStatus;
  projectId: string | null;
  mainMode: 'interface' | 'data-api';
  onMainModeChange: (mode: 'interface' | 'data-api') => void;
  leftTab: LeftTabId;
  onSetLeftTab: (t: LeftTabId) => void;
  onOpenAuthConfig: () => void;
  onOpenPageConfig: () => void;
}) {
  const { undo, redo, historyIdx, history, viewport, setViewport, pages, currentPageId, aiMode, toggleAiMode } = useBuilderStore(
    useShallow(s => ({
      undo: s.undo, redo: s.redo, historyIdx: s.historyIdx, history: s.history,
      viewport: s.viewport, setViewport: s.setViewport,
      pages: s.pages, currentPageId: s.currentPageId,
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
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPaywall, setExportPaywall] = useState<{ price: number; message: string } | null>(null);
  const [exportPaywallLoading, setExportPaywallLoading] = useState(false);
  const [exportPaywallError, setExportPaywallError] = useState('');
  const [envVarsOpen, setEnvVarsOpen] = useState(false);

  // ── Deploy state ────────────────────────────────────────────────────────────
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployPublished, setDeployPublished] = useState(false);
  const [deployPublishedAt, setDeployPublishedAt] = useState<string | null>(null);
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployError, setDeployError] = useState('');
  const [deployLabel, setDeployLabel] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [customDomainVerified, setCustomDomainVerified] = useState(false);
  const [domainInput, setDomainInput] = useState('');
  const [domainSaving, setDomainSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [versions, setVersions] = useState<Array<{ id: string; label: string | null; createdAt: string }>>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  const liveUrl = appDomain
    ? `https://${projectId}.${appDomain}`
    : `http://${projectId}.localhost:3001`;

  // Load deploy status + version history when modal opens
  useEffect(() => {
    if (!deployOpen || !projectId) return;
    setDeployError('');
    setVersionsOpen(false);
    fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then((data: { project?: { published?: boolean; publishedAt?: string | null; customDomain?: string | null; customDomainVerified?: boolean } }) => {
        setDeployPublished(data.project?.published ?? false);
        setDeployPublishedAt(data.project?.publishedAt ?? null);
        setCustomDomain(data.project?.customDomain ?? '');
        setDomainInput(data.project?.customDomain ?? '');
        setCustomDomainVerified(data.project?.customDomainVerified ?? false);
      })
      .catch(() => {});
    fetch(`/api/projects/${projectId}/versions`)
      .then(r => r.json())
      .then((data: { versions?: Array<{ id: string; label: string | null; createdAt: string }> }) => {
        setVersions(data.versions ?? []);
      })
      .catch(() => {});
  }, [deployOpen, projectId]);

  async function handleDeploy() {
    if (!projectId) return;
    setDeployLoading(true);
    setDeployError('');
    const endpoint = deployPublished ? 'unpublish' : 'publish';
    try {
      const res = await fetch(`/api/projects/${projectId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: endpoint === 'publish' ? JSON.stringify({ label: deployLabel.trim() || null }) : undefined,
      });
      const data = await res.json() as { ok?: boolean; published?: boolean; publishedAt?: string; error?: string; code?: string };
      if (!res.ok) {
        setDeployError(data.error ?? 'Failed');
      } else {
        const nowPublished = !deployPublished;
        setDeployPublished(nowPublished);
        if (nowPublished) {
          if (data.publishedAt) setDeployPublishedAt(data.publishedAt);
          setDeployLabel('');
          // Refresh version list so the new version appears immediately
          fetch(`/api/projects/${projectId}/versions`)
            .then(r => r.json())
            .then((d: { versions?: Array<{ id: string; label: string | null; createdAt: string }> }) => setVersions(d.versions ?? []))
            .catch(() => {});
        } else {
          setDeployPublishedAt(null);
        }
      }
    } catch {
      setDeployError('Network error');
    } finally {
      setDeployLoading(false);
    }
  }

  async function handleRestore(versionId: string) {
    if (!projectId) return;
    setRestoring(versionId);
    setDeployError('');
    try {
      const res = await fetch(`/api/projects/${projectId}/versions/${versionId}/restore`, { method: 'POST' });
      const data = await res.json() as { ok?: boolean; publishedAt?: string; error?: string };
      if (!res.ok) {
        setDeployError(data.error ?? 'Restore failed');
      } else {
        setDeployPublished(true);
        if (data.publishedAt) setDeployPublishedAt(data.publishedAt);
      }
    } catch {
      setDeployError('Network error');
    } finally {
      setRestoring(null);
    }
  }

  async function handleSaveDomain() {
    if (!projectId || !domainInput) return;
    setDomainSaving(true);
    setVerifyMsg('');
    try {
      const res = await fetch(`/api/projects/${projectId}/custom-domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainInput }),
      });
      const data = await res.json() as { ok?: boolean; customDomain?: string | null; error?: string };
      if (res.ok) {
        setCustomDomain(data.customDomain ?? domainInput);
        setCustomDomainVerified(false);
        setVerifyMsg('Saved. Add a CNAME record then click Verify DNS.');
      } else {
        setVerifyMsg(data.error ?? 'Failed to save');
      }
    } catch {
      setVerifyMsg('Network error');
    } finally {
      setDomainSaving(false);
    }
  }

  async function handleVerifyDomain() {
    if (!projectId) return;
    setVerifying(true);
    setVerifyMsg('');
    try {
      const res = await fetch(`/api/projects/${projectId}/custom-domain/verify`, { method: 'POST' });
      const data = await res.json() as { verified?: boolean; message?: string };
      setCustomDomainVerified(data.verified ?? false);
      setVerifyMsg(data.message ?? '');
    } catch {
      setVerifyMsg('Network error');
    } finally {
      setVerifying(false);
    }
  }

  async function handleRemoveDomain() {
    if (!projectId) return;
    await fetch(`/api/projects/${projectId}/custom-domain`, { method: 'DELETE' });
    setCustomDomain('');
    setDomainInput('');
    setCustomDomainVerified(false);
    setVerifyMsg('');
  }

  async function handleExportClick() {
    if (!projectId) return;
    setExportPaywallLoading(true);
    setExportPaywallError('');
    try {
      const res = await projectsApi.authoriseExport(projectId);
      if (res.approved) {
        if (res.price === 0) {
          // Super admin or free — go straight to export
          setExportOpen(true);
        } else {
          // Show paywall confirmation
          setExportPaywall({ price: res.price, message: res.message });
        }
      }
    } catch (err) {
      setExportPaywallError((err as Error).message ?? 'Export not available');
      setExportPaywall({ price: -1, message: '' }); // show error state
    } finally {
      setExportPaywallLoading(false);
    }
  }

  return (
    <div
      style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        background: 'var(--bld-bg-base)',
        borderBottom: '1px solid var(--bld-border)',
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
            fontSize: 10, color: 'var(--bld-text-disabled)',
            textDecoration: 'none',
            padding: '2px 6px',
            borderRadius: 4,
            fontFamily: 'system-ui',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-text-3)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
        >
          ← Projects
        </a>
      )}

      <div style={{ width: 1, height: 20, background: 'var(--bld-border)' }} />

      {/* History */}
      <TopBarBtn disabled={!canUndo} onClick={undo} title="Undo (⌘Z)"   testId="btn-undo">↩</TopBarBtn>
      <TopBarBtn disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)" testId="btn-redo">↪</TopBarBtn>

      <div style={{ width: 1, height: 20, background: 'var(--bld-border)' }} />

      {/* Pages picker dropdown (replaces the static page name in the centre) */}
      <PagesPicker onOpenPageConfig={onOpenPageConfig} />

      {/* URL query parameter definitions for the current page */}
      <URLParamsPopover />

      <div style={{ width: 1, height: 20, background: 'var(--bld-border)' }} />

      {/* Mode switcher — icon-only */}
      {([
        {
          id: 'interface' as const,
          title: 'Interface',
          icon: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.9"/>
              <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.9"/>
              <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.9"/>
              <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.9"/>
            </svg>
          ),
        },
        {
          id: 'data-api' as const,
          title: 'Data & API',
          icon: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <ellipse cx="7" cy="3.5" rx="5" ry="2" stroke="currentColor" strokeWidth="1.2" fill="none"/>
              <path d="M2 3.5v3.5c0 1.1 2.24 2 5 2s5-.9 5-2V3.5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
              <path d="M2 7v3c0 1.1 2.24 2 5 2s5-.9 5-2V7" stroke="currentColor" strokeWidth="1.2" fill="none"/>
            </svg>
          ),
        },
      ] as const).map(tab => (
        <button
          key={tab.id}
          onClick={() => onMainModeChange(tab.id)}
          title={tab.title}
          style={{
            width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: mainMode === tab.id ? 'var(--bld-accent-hover)' : 'transparent',
            border: `1px solid ${mainMode === tab.id ? 'var(--bld-accent)' : 'transparent'}`,
            borderRadius: 5,
            color: mainMode === tab.id ? 'var(--bld-accent-fg)' : 'var(--bld-text-disabled)',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (mainMode !== tab.id) { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; } }}
          onMouseLeave={e => { if (mainMode !== tab.id) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; } }}
        >
          {tab.icon}
        </button>
      ))}

      <div style={{ width: 1, height: 20, background: 'var(--bld-border)' }} />

      {/* ── Left-panel overlay tabs: Triggers / Assets / Theme ── */}
      {([
        {
          id: 'triggers' as LeftTabId,
          title: 'App Triggers',
          icon: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8 1.5L3.5 7.5H7L5 13l6-8H8l0-3.5z" fill="currentColor"/>
            </svg>
          ),
        },
        {
          id: 'assets' as LeftTabId,
          title: 'Assets',
          icon: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="2.5" width="11" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2" fill="none"/>
              <circle cx="5" cy="5.5" r="1.1" fill="currentColor"/>
              <path d="M1.5 9.5L4.5 6.5 7 9 9.5 6.5 12.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          ),
        },
        {
          id: 'theme' as LeftTabId,
          title: 'Theme',
          icon: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" fill="none"/>
              <circle cx="5" cy="5" r="1.2" fill="currentColor"/>
              <circle cx="9" cy="5" r="1.2" fill="currentColor"/>
              <circle cx="5" cy="9" r="1.2" fill="currentColor"/>
              <circle cx="9" cy="9" r="1.2" fill="currentColor"/>
            </svg>
          ),
        },
        {
          id: 'files' as LeftTabId,
          title: 'Config Files',
          icon: (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 2h4.5l3 3v6.5a1 1 0 01-1 1h-6.5a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round"/>
              <path d="M8 2v3h3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5 7.5h4M5 9.5h2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
          ),
        },
      ] as const).map(btn => {
        const isActive = leftTab === btn.id && mainMode === 'interface';
        return (
          <button
            key={btn.id}
            data-testid={`navbar-tab-${btn.id}`}
            onClick={() => {
              if (mainMode !== 'interface') onMainModeChange('interface');
              onSetLeftTab(isActive && leftTab === btn.id ? 'components' : btn.id);
            }}
            title={btn.title}
            style={{
              width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isActive ? 'var(--bld-accent-hover)' : 'transparent',
              border: `1px solid ${isActive ? 'var(--bld-accent)' : 'transparent'}`,
              borderRadius: 5,
              color: isActive ? 'var(--bld-accent-fg)' : 'var(--bld-text-disabled)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; } }}
            onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; } }}
          >
            {btn.icon}
          </button>
        );
      })}

      {/* Env vars panel button */}
      <button
        data-testid="navbar-env-btn"
        onClick={() => setEnvVarsOpen(true)}
        title="Environment Variables"
        style={{
          width: 28, height: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 5,
          color: 'var(--bld-text-disabled)',
          cursor: 'pointer',
          transition: 'all 0.15s',
          fontSize: 13,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; }}
      >⚙</button>

      {/* Auth settings icon button */}
      <button
        data-testid="navbar-auth-btn"
        onClick={onOpenAuthConfig}
        title="Auth settings (token, user endpoint, redirects)"
        style={{
          width: 28, height: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 5,
          color: 'var(--bld-text-disabled)',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </button>

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
            background: viewport === v ? 'var(--bld-accent-hover)' : 'transparent',
            border: `1px solid ${viewport === v ? 'var(--bld-accent)' : 'transparent'}`,
            borderRadius: 4,
            color: viewport === v ? 'var(--bld-accent-fg)' : 'var(--bld-text-disabled)',
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

      {/* Builder chrome theme toggle */}
      <BuilderThemeToggle />
      {/* App preview dark/light toggle */}
      <DarkModeToggle />

      {/* AI Assistant toggle */}
      <button
        data-testid="btn-ai-mode"
        onClick={toggleAiMode}
        title={aiMode ? 'Close AI Assistant' : 'Open AI Assistant'}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px',
          background: aiMode ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'var(--bld-bg-elevated)',
          border: `1px solid ${aiMode ? '#7c3aed' : 'var(--bld-border-subtle)'}`,
          borderRadius: 5,
          color: aiMode ? '#fff' : 'var(--bld-text-3)',
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
          background: canPreview ? 'var(--bld-success)' : 'var(--bld-border-subtle)',
          border: 'none',
          borderRadius: 5,
          color: canPreview ? '#fff' : 'var(--bld-text-disabled)',
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

      {/* Deploy button */}
      {projectId && (
        <button
          data-testid="btn-deploy"
          onClick={() => setDeployOpen(true)}
          title="Deploy your app to the web"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 12px',
            background: deployPublished
              ? 'linear-gradient(135deg, #059669, #047857)'
              : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            border: 'none',
            borderRadius: 5,
            color: '#fff',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'system-ui',
            letterSpacing: '0.02em',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          {deployPublished ? (
            <>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'inline-block', boxShadow: '0 0 4px #4ade80' }} />
              Live
            </>
          ) : '🚀 Deploy'}
        </button>
      )}

      {/* Export button */}
      <button
        data-testid="btn-export"
        onClick={handleExportClick}
        disabled={exportPaywallLoading}
        title="Export as standalone React/Next.js project"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 12px',
          background: 'var(--bld-accent-hover)',
          border: 'none',
          borderRadius: 5,
          color: '#fff',
          cursor: exportPaywallLoading ? 'not-allowed' : 'pointer',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'system-ui',
          letterSpacing: '0.02em',
          opacity: exportPaywallLoading ? 0.7 : 1,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!exportPaywallLoading) (e.currentTarget.style.background = 'var(--bld-accent)'); }}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--bld-accent-hover)')}
      >
        {exportPaywallLoading ? '…' : '↓ Export'}
      </button>

      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}

      {/* Env vars panel */}
      <EnvVarsPanel
        projectId={projectId ?? ''}
        open={envVarsOpen}
        onClose={() => setEnvVarsOpen(false)}
      />

      {/* Deploy modal */}
      {deployOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setDeployOpen(false); }}
        >
          <div style={{ width: 440, maxHeight: '90vh', overflowY: 'auto', background: 'var(--bld-bg-panel)', borderRadius: 14, border: '1px solid var(--bld-border)', boxShadow: 'var(--bld-shadow-lg)', padding: 28, fontFamily: 'system-ui' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--bld-text-1)', margin: 0 }}>Deploy</h2>
                <p style={{ fontSize: 11.5, color: 'var(--bld-text-disabled)', margin: '3px 0 0' }}>
                  Visitors always see the last deployed snapshot
                </p>
              </div>
              <button onClick={() => setDeployOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
            </div>

            {/* Deploy status card */}
            <div style={{ background: 'var(--bld-bg-input)', borderRadius: 10, padding: '16px', marginBottom: 16 }}>
              {/* Status row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    {deployPublished ? (
                      <>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block', boxShadow: '0 0 6px #4ade80' }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>Live</span>
                      </>
                    ) : (
                      <>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--bld-text-disabled)', display: 'inline-block' }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-disabled)' }}>Not deployed</span>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>
                    {deployPublishedAt
                      ? `Last deployed ${(() => { const d = new Date(deployPublishedAt); const diff = Date.now() - d.getTime(); if (diff < 60000) return 'just now'; if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`; if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`; return d.toLocaleDateString(); })()}`
                      : 'Never deployed'}
                  </div>
                </div>
                <button
                  onClick={handleDeploy}
                  disabled={deployLoading}
                  style={{
                    padding: '6px 18px', borderRadius: 7, border: 'none', cursor: deployLoading ? 'not-allowed' : 'pointer',
                    background: deployPublished ? '#7f1d1d' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                    color: '#fff', fontSize: 12, fontWeight: 600,
                    opacity: deployLoading ? 0.7 : 1,
                  }}
                >
                  {deployLoading ? '…' : (deployPublished ? 'Undeploy' : 'Deploy now')}
                </button>
              </div>

              {/* Optional deploy label */}
              {!deployPublished && (
                <input
                  value={deployLabel}
                  onChange={e => setDeployLabel(e.target.value)}
                  placeholder="Label (optional, e.g. v1.2 or Launch)"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: 11.5, borderRadius: 6,
                    border: '1px solid var(--bld-border)', background: 'var(--bld-bg-panel)',
                    color: 'var(--bld-text-1)', outline: 'none', marginBottom: 10,
                  }}
                />
              )}

              {/* Live URL */}
              {deployPublished && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid var(--bld-border)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--bld-text-disabled)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                  <a href={liveUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: '#60a5fa', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {liveUrl}
                  </a>
                  <button
                    onClick={() => navigator.clipboard?.writeText(liveUrl)}
                    title="Copy URL"
                    style={{ padding: '3px 6px', borderRadius: 4, border: '1px solid var(--bld-border)', background: 'none', color: 'var(--bld-text-disabled)', fontSize: 10, cursor: 'pointer' }}
                  >
                    Copy
                  </button>
                </div>
              )}

              {deployError && (
                <p style={{ fontSize: 11.5, color: '#f87171', marginTop: 10, marginBottom: 0 }}>{deployError}</p>
              )}
            </div>

            {/* Version history */}
            {versions.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={() => setVersionsOpen(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: '100%', marginBottom: versionsOpen ? 10 : 0 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--bld-text-2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.15s', transform: versionsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--bld-text-2)' }}>
                    Version history ({versions.length})
                  </span>
                </button>

                {versionsOpen && (
                  <div style={{ background: 'var(--bld-bg-input)', borderRadius: 10, overflow: 'hidden' }}>
                    {versions.map((v, i) => {
                      const d = new Date(v.createdAt);
                      const timeStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                      const isRestoring = restoring === v.id;
                      return (
                        <div
                          key={v.id}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderTop: i > 0 ? '1px solid var(--bld-border)' : 'none',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-1)' }}>
                              {v.label ?? (i === 0 ? 'Latest deploy' : `Deploy ${versions.length - i}`)}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', marginTop: 2 }}>{timeStr}</div>
                          </div>
                          {i > 0 && (
                            <button
                              onClick={() => handleRestore(v.id)}
                              disabled={!!restoring}
                              style={{
                                padding: '4px 12px', fontSize: 11, borderRadius: 6,
                                border: '1px solid var(--bld-border)', background: 'none',
                                color: isRestoring ? 'var(--bld-text-disabled)' : 'var(--bld-text-2)',
                                cursor: restoring ? 'not-allowed' : 'pointer', fontWeight: 600,
                              }}
                            >
                              {isRestoring ? '…' : 'Restore'}
                            </button>
                          )}
                          {i === 0 && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#4ade80', background: 'rgba(74,222,128,0.1)', borderRadius: 4, padding: '2px 7px' }}>current</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Custom domain */}
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--bld-text-2)', marginBottom: 10 }}>Custom domain</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input
                  value={domainInput}
                  onChange={e => setDomainInput(e.target.value)}
                  placeholder="your-app.com"
                  style={{
                    flex: 1, padding: '7px 10px', fontSize: 12, borderRadius: 7,
                    border: '1px solid var(--bld-border)', background: 'var(--bld-bg-input)',
                    color: 'var(--bld-text-1)', outline: 'none',
                  }}
                />
                <button
                  onClick={handleSaveDomain}
                  disabled={domainSaving || !domainInput}
                  style={{ padding: '7px 12px', fontSize: 12, borderRadius: 7, border: 'none', background: 'var(--bld-accent)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                >
                  {domainSaving ? '…' : 'Save'}
                </button>
              </div>

              {customDomain && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11.5, color: customDomainVerified ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>
                    {customDomainVerified ? '✓ Verified' : '⚠ Unverified'}
                  </span>
                  <button
                    onClick={handleVerifyDomain}
                    disabled={verifying}
                    style={{ padding: '3px 10px', fontSize: 11, borderRadius: 5, border: '1px solid var(--bld-border)', background: 'none', color: 'var(--bld-text-3)', cursor: 'pointer' }}
                  >
                    {verifying ? '…' : 'Verify DNS'}
                  </button>
                  <button
                    onClick={handleRemoveDomain}
                    style={{ padding: '3px 10px', fontSize: 11, borderRadius: 5, border: '1px solid var(--bld-border)', background: 'none', color: '#f87171', cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                </div>
              )}

              {customDomain && !customDomainVerified && (
                <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', background: 'var(--bld-bg-input)', borderRadius: 7, padding: '10px 12px', lineHeight: 1.5 }}>
                  Add a CNAME record pointing:<br />
                  <code style={{ color: '#93c5fd' }}>{customDomain}</code> → <code style={{ color: '#86efac' }}>{projectId}.{appDomain ?? 'localhost:3001'}</code>
                </div>
              )}

              {verifyMsg && (
                <p style={{ fontSize: 11.5, color: customDomainVerified ? '#4ade80' : '#fbbf24', marginTop: 8, marginBottom: 0 }}>{verifyMsg}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export paywall modal */}
      {exportPaywall && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div style={{ width: 380, background: 'var(--bld-bg-panel)', borderRadius: 14, border: '1px solid var(--bld-border)', boxShadow: 'var(--bld-shadow-lg)', padding: 28 }}>
            {exportPaywall.price === -1 ? (
              <>
                <div style={{ fontSize: 22, marginBottom: 12 }}>⚠️</div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--bld-text-1)', margin: '0 0 8px' }}>Export unavailable</h2>
                <p style={{ fontSize: 13, color: 'var(--bld-text-3)', marginBottom: 20 }}>{exportPaywallError}</p>
                <button
                  onClick={() => { setExportPaywall(null); setExportPaywallError(''); }}
                  style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--bld-border-subtle)', color: 'var(--bld-text-1)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 22, marginBottom: 12 }}>📦</div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--bld-text-1)', margin: '0 0 8px' }}>Export as React Code</h2>
                <p style={{ fontSize: 13, color: 'var(--bld-text-3)', marginBottom: 6 }}>
                  Each export is a one-time purchase.
                </p>
                <div style={{ background: 'var(--bld-bg-input)', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--bld-text-2)' }}>Export fee</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--bld-text-1)' }}>
                      ${(exportPaywall.price / 100).toFixed(2)}
                    </span>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--bld-text-disabled)', margin: '6px 0 0' }}>{exportPaywall.message}</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setExportPaywall(null)}
                    style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--bld-border-subtle)', background: 'transparent', color: 'var(--bld-text-3)', fontSize: 13, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { setExportPaywall(null); setExportOpen(true); }}
                    style={{ flex: 2, padding: '9px', borderRadius: 8, border: 'none', background: 'var(--bld-accent)', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Pay ${(exportPaywall.price / 100).toFixed(2)} &amp; Export
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ width: 1, height: 20, background: 'var(--bld-border)' }} />

      {/* Autosave status */}
      <SaveStatusBadge status={saveStatus} />
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
        color: disabled ? 'var(--bld-border-subtle)' : 'var(--bld-text-3)',
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

type LeftTabId = 'layers' | 'components' | 'data' | 'logic' | 'triggers' | 'assets' | 'theme' | 'files';

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

type RightSlideState =
  | { kind: 'addColor' }
  | { kind: 'editColor'; id: string }
  | null;

function rightSlideTitle(state: RightSlideState): string {
  if (!state) return '';
  if (state.kind === 'addColor') return 'New Custom Color';
  if (state.kind === 'editColor') return 'Edit Custom Color';
  return '';
}

function BuilderPageInner() {
  const initTheme = useBuilderStore(s => s.initTheme);
  const loadFromConfig = useBuilderStore(s => s.loadFromConfig);
  const setProjectContext = useBuilderStore(s => s.setProjectContext);
  const setAiPendingMessage = useBuilderStore(s => s.setAiPendingMessage);
  const toggleAiMode = useBuilderStore(s => s.toggleAiMode);
  const aiMode = useBuilderStore(s => s.aiMode);
  const builderTheme = useBuilderStore(s => s.builderTheme);
  const workflowCanvasTarget = useBuilderStore(s => s.workflowCanvasTarget);
  const closeWorkflowCanvas = useBuilderStore(s => s.closeWorkflowCanvas);
  const [mainMode, setMainMode] = useState<'interface' | 'data-api'>('interface');
  const [leftTab, setLeftTab] = useState<LeftTabId>('components');
  const [leftSlide, setLeftSlide] = useState<LeftSlideState>(null);
  const [leftSlideWidth, setLeftSlideWidth] = useState(320);
  const [rightSlide, setRightSlide] = useState<RightSlideState>(null);
  const rightSlideWidth = 320;
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

  // Sync left-panel tab from custom events (e.g. "Open Theme tab" from right-click menu)
  useEffect(() => {
    const handleOpenTheme = () => setLeftTab('theme');
    const handleOpenLeftTab = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail as LeftTabId;
      if (['triggers', 'layers', 'components', 'data', 'logic', 'assets', 'theme'].includes(detail)) {
        setLeftTab(detail);
      }
    };
    window.addEventListener('builder:open-theme-tab', handleOpenTheme);
    window.addEventListener('builder:open-left-tab', handleOpenLeftTab);
    return () => {
      window.removeEventListener('builder:open-theme-tab', handleOpenTheme);
      window.removeEventListener('builder:open-left-tab', handleOpenLeftTab);
    };
  }, []);

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

  // Inject env vars (dev values) into the SDUI store so env['KEY'] formulas
  // evaluate correctly on the builder canvas and in formula editor previews.
  useEffect(() => {
    if (!projectId) return;
    envVariables.list(projectId)
      .then((r) => {
        const map: Record<string, string> = {};
        for (const v of r.envVariables) map[v.name] = v.devValue;
        useSduiStore.getState().setData('env', map);
      })
      .catch(() => {});
  }, [projectId]);

  // __builderStore is exposed at module level in _store.ts for E2E tests

  // Re-apply custom-color CSS vars + THEME_OBJ once the project config has
  // loaded. loadFromConfig already calls _applyLightOverrides, but the
  // SDUIEngine event listener may not be registered yet at that point.
  // Calling initTheme() here guarantees all active and inactive page engines
  // receive the `sdui:theme-colors-patched` event after they have mounted.
  // Re-apply CSS vars + THEME_OBJ after the project config loads, and again
  // whenever the user adds/edits/removes a custom color so all page engines
  // (active and inactive) immediately reflect the change.
  const customColors = useBuilderStore(s => s.customColors);
  useEffect(() => {
    if (configLoading) return;
    useBuilderStore.getState().initTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoading, customColors]);

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
    const { pageNodes, viewport, pages, currentPageId, themeOverrides, themeDarkOverrides, pageWorkflows, pageWorkflowMeta, globalWorkflows, globalWorkflowMeta, customVars, customColors } = useBuilderStore.getState();
    const currentPage = pages.find(p => p.id === currentPageId);

    // Always save to localStorage so the standalone preview (/dev/builder/preview) still works.
    // Include sharedComponents so template-imported SCs are available in the preview tab.
    const { getSharedComponents } = await import('@/lib/builder/shared-component-data');
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
      customColors,
      sharedComponents: getSharedComponents(),
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

      // Navigate to the project-specific preview subdomain ({projectId}-preview.*).
      // The middleware requires a preview_token cookie — passed via query param
      // on first load and then stored as a cookie.
      let previewUrl = `${window.location.protocol}//${projectId}-preview.${baseHost}${pageRoute}`;
      // Always include a cache-bust timestamp so the preview tab fetches fresh
      // data from the backend instead of serving a stale sessionStorage hit.
      const sep = pageRoute.includes('?') ? '&' : '?';
      previewUrl += `${sep}_t=${Date.now()}`;
      if (previewToken) {
        previewUrl += `&token=${encodeURIComponent(previewToken)}`;
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
        width: '100vw', height: '100vh', background: 'var(--bld-bg-base)',
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
            borderTopColor: 'var(--bld-accent)',
            animation: 'spin 0.75s linear infinite',
          }} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--bld-text-3)', letterSpacing: '0.02em' }}>
          Loading project…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      data-builder-ui
      data-bld-theme={builderTheme}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bld-bg-base)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <TopBar
        onPreview={openPreview}
        saveStatus={saveStatus}
        projectId={projectId}
        mainMode={mainMode}
        onMainModeChange={setMainMode}
        leftTab={leftTab}
        onSetLeftTab={setLeftTab}
        onOpenAuthConfig={() => { setLeftSlideWidth(360); setLeftSlide({ kind: 'authConfig' }); }}
        onOpenPageConfig={() => { setLeftSlideWidth(320); setLeftSlide({ kind: 'pageConfig' }); }}
      />

      {/* ── Data & API full-screen view ────────────────────────────────────── */}
      {mainMode === 'data-api' && projectId && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <DataApiTab projectId={projectId} />
        </div>
      )}

      {mainMode === 'interface' && (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <PanelLeft
          activeTab={leftTab}
          onTabChange={setLeftTab}
          dataSlideState={leftSlide?.kind === 'data' ? leftSlide.subState : null}
          onSetDataSlide={s => {
            // Reset width to default when switching to a non-datasource slide (e.g. variable)
            if (!s || s.kind !== 'dataSource') setLeftSlideWidth(320);
            setLeftSlide(s ? { kind: 'data', subState: s } : null);
          }}
          logicSlideState={leftSlide?.kind === 'logic' ? leftSlide.subState : null}
          onSetLogicSlide={s => { setLeftSlideWidth(320); setLeftSlide(s ? { kind: 'logic', subState: s } : null); }}
          onWidthChange={setLeftSlideWidth}
          onOpenColorSlide={setRightSlide}
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

        {/* Right SlidePanel — slides in between canvas and right panel (mirrors left side) */}
        {rightSlide && (
          <SlidePanel
            title={rightSlideTitle(rightSlide)}
            side="right"
            onClose={() => setRightSlide(null)}
            width={rightSlideWidth}
            testId="right-slide-panel"
          >
            {(rightSlide.kind === 'addColor' || rightSlide.kind === 'editColor') && (() => {
              const editing = rightSlide.kind === 'editColor'
                ? useBuilderStore.getState().customColors.find(c => c.id === rightSlide.id) ?? null
                : null;
              const initial = rightSlide.kind === 'addColor'
                ? { isNew: true } as Partial<CustomColor> & { isNew?: boolean }
                : (editing ?? { isNew: true });
              return (
                <CustomColorSlideContent
                  initial={initial}
                  onSave={(c) => {
                    const store = useBuilderStore.getState();
                    if (rightSlide.kind === 'addColor') store.addCustomColor(c);
                    else store.updateCustomColor(c.id, c);
                    setRightSlide(null);
                  }}
                  onClose={() => setRightSlide(null)}
                />
              );
            })()}
          </SlidePanel>
        )}

        <PanelRight />
      </div>
      )} {/* end mainMode === 'interface' */}

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

import { Suspense } from 'react';
export default function BuilderPage() {
  return (
    <Suspense>
      <BuilderPageInner />
    </Suspense>
  );
}
