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

import React, { useEffect, useRef, useState, useCallback, startTransition, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
import { FileViewerDrawer } from './_file-viewer-drawer';
import { FileExplorerOverlay } from './_files-panel';
import { ExportModal } from './_export-modal';
import { projects as projectsApi, workspaces as workspacesApi, envVariables, auth } from '@/lib/platform/api-client';
import AiTokenMeter from '@/app/(platform)/_ai-token-meter';
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

  // Sync theme to <html> so portals (ReactDOM.createPortal → document.body)
  // also receive the light-theme token overrides.
  useEffect(() => {
    const el = document.documentElement;
    if (builderTheme === 'light') {
      el.setAttribute('data-bld-theme', 'light');
    } else {
      el.removeAttribute('data-bld-theme');
    }
    return () => el.removeAttribute('data-bld-theme');
  }, [builderTheme]);

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

  const PageIcon = () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z"/>
      <path d="M9 2v4h4"/>
    </svg>
  );

  return (
    <div ref={containerRef} style={{ position: 'relative' }} data-testid="pages-picker">
      {/* Trigger */}
      <button
        data-testid="pages-picker-trigger"
        onClick={() => { setOpen(v => !v); setSearch(''); setShowAdd(false); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px',
          background: open ? 'var(--bld-bg-elevated)' : 'transparent',
          border: `1px solid ${open ? 'var(--bld-glass-border)' : 'transparent'}`,
          borderRadius: 7, color: 'var(--bld-text-2)', cursor: 'pointer',
          fontSize: 11, minWidth: 100, maxWidth: 200, transition: 'all 0.12s',
        }}
        onMouseEnter={e => { if (!open) { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.borderColor = 'var(--bld-glass-border)'; } }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; } }}
      >
        <span style={{ color: 'var(--bld-text-disabled)', flexShrink: 0 }}><PageIcon /></span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, color: 'var(--bld-text-1)' }}>
          {currentPage?.name ?? 'Select page'}
        </span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: 'var(--bld-text-disabled)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          minWidth: 260, maxWidth: 320,
          background: 'var(--bld-glass-bg)',
          border: '1px solid var(--bld-glass-border)',
          borderRadius: 12,
          boxShadow: 'var(--bld-shadow-lg)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          zIndex: 99999, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Search */}
          <div style={{ padding: '8px 10px 6px' }}>
            <div style={{ position: 'relative' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
                style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--bld-text-disabled)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                autoFocus placeholder="Search pages…" value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border)',
                  borderRadius: 7, color: 'var(--bld-text-2)', fontSize: 11, padding: '5px 8px 5px 26px',
                  boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Page list */}
          <div style={{ overflowY: 'auto', maxHeight: 240, padding: '2px 6px' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 8px', fontSize: 11, color: 'var(--bld-text-3)', fontStyle: 'italic' }}>No pages match</div>
            )}
            {filtered.map((page: BuilderPage) => {
              const isActive = page.id === currentPageId;
              const isRenaming = renamingId === page.id;
              return (
                <div key={page.id} data-testid={`pages-picker-row-${page.id}`}
                  onClick={() => { if (!isRenaming) { navigatePage(page.id); setOpen(false); setSearch(''); } }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '6px 8px', cursor: 'pointer', borderRadius: 7,
                    background: isActive ? 'var(--bld-bg-active)' : 'transparent',
                    marginBottom: 1,
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bld-bg-hover)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ color: isActive ? 'var(--bld-accent)' : 'var(--bld-text-disabled)', flexShrink: 0 }}><PageIcon /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isRenaming ? (
                      <input autoFocus value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); e.stopPropagation(); }}
                        onClick={e => e.stopPropagation()}
                        style={{ width: '100%', background: 'var(--bld-bg-input)', border: '1px solid var(--bld-accent)', borderRadius: 4, color: 'var(--bld-text-1)', fontSize: 11, padding: '1px 5px', boxSizing: 'border-box' }}
                      />
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: isActive ? 'var(--bld-text-1)' : 'var(--bld-text-2)', fontWeight: isActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          onDoubleClick={e => { e.stopPropagation(); setRenamingId(page.id); setRenameValue(page.name); }}>
                          {page.name}
                        </div>
                        {page.route && <div style={{ fontSize: 9, color: 'var(--bld-text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{page.route}</div>}
                      </>
                    )}
                  </div>
                  {!isRenaming && (
                    <div style={{ display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                      onClick={e => e.stopPropagation()}
                    >
                      <button title="Page settings"
                        onClick={e => { e.stopPropagation(); navigatePage(page.id); setOpen(false); onOpenPageConfig(); }}
                        style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', padding: '3px 4px', borderRadius: 4, display: 'flex', alignItems: 'center' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-text-2)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                      </button>
                      <button title="Remove page" onClick={e => { e.stopPropagation(); removePage(page.id); }}
                        style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', padding: '3px 4px', borderRadius: 4, display: 'flex', alignItems: 'center', fontSize: 13, lineHeight: 1 }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-error)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}>×</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add page footer */}
          <div style={{ borderTop: '1px solid var(--bld-border)', margin: '4px 0 0' }}>
            {!showAdd ? (
              <button data-testid="pages-picker-add" onClick={() => setShowAdd(true)}
                style={{
                  width: '100%', padding: '8px 14px', background: 'transparent', border: 'none',
                  color: 'var(--bld-text-disabled)', fontSize: 11, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bld-bg-hover)'; e.currentTarget.style.color = 'var(--bld-text-2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>
                New page
              </button>
            ) : (
              <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 500 }}>Custom route</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input autoFocus placeholder="/my-page" value={customRoute}
                    onChange={e => setCustomRoute(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCustom(); if (e.key === 'Escape') setShowAdd(false); e.stopPropagation(); }}
                    style={{ flex: 1, background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border)', borderRadius: 6, color: 'var(--bld-text-1)', fontSize: 11, padding: '5px 8px', outline: 'none', fontFamily: 'monospace' }}
                  />
                  <button onClick={handleAddCustom} disabled={!customRoute.trim()}
                    style={{ padding: '5px 12px', background: customRoute.trim() ? 'var(--bld-accent)' : 'var(--bld-bg-elevated)', border: 'none', borderRadius: 6, color: customRoute.trim() ? '#fff' : 'var(--bld-text-disabled)', fontSize: 11, fontWeight: 500, cursor: customRoute.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
                    Add
                  </button>
                </div>
                {isAdminMode && (
                  <>
                    <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 500, marginTop: 2 }}>App routes</div>
                    <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                      {allRoutes.map(r => {
                        const alreadyAdded = pages.some((p: BuilderPage) => p.route === r.path);
                        return (
                          <button key={r.config} disabled={alreadyAdded}
                            onClick={() => { if (!alreadyAdded) { addPage(r.path, r.config); setShowAdd(false); setOpen(false); } }}
                            style={{ display: 'flex', width: '100%', alignItems: 'baseline', gap: 6, padding: '5px 4px', background: 'none', border: 'none', color: alreadyAdded ? 'var(--bld-text-disabled)' : 'var(--bld-text-2)', fontSize: 11, textAlign: 'left', cursor: alreadyAdded ? 'default' : 'pointer', borderRadius: 5 }}
                            onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--bld-bg-hover)'; }}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                            <span style={{ fontFamily: 'monospace', fontSize: 10, color: alreadyAdded ? 'var(--bld-text-disabled)' : 'var(--bld-info)', flexShrink: 0 }}>{r.path}</span>
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

// ─── Node JSON Panel ──────────────────────────────────────────────────────────

function NodeJsonPanel({ onClose }: { onClose: () => void }) {
  const { selectedIds, pageNodes } = useBuilderStore(useShallow(s => ({ selectedIds: s.selectedIds, pageNodes: s.pageNodes })));
  const [copyDone, setCopyDone] = React.useState(false);

  // Find selected node in pageNodes
  const selectedNode = React.useMemo(() => {
    if (selectedIds.length !== 1) return null;
    function find(nodes: unknown[]): unknown {
      for (const n of nodes) {
        const node = n as Record<string, unknown>;
        if (node.id === selectedIds[0]) return node;
        if (Array.isArray(node.children)) {
          const found = find(node.children as unknown[]);
          if (found) return found;
        }
      }
      return null;
    }
    return find(pageNodes as unknown[]);
  }, [selectedIds, pageNodes]);

  const json = selectedNode ? JSON.stringify(selectedNode, null, 2) : '// No node selected';

  const handleCopy = () => {
    navigator.clipboard.writeText(json).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1500);
    });
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', pointerEvents: 'none' }}
    >
      <div
        style={{
          marginTop: 44, marginRight: 268, width: 340, maxHeight: 'calc(100vh - 60px)',
          background: 'var(--bld-bg-base)', border: '1px solid var(--bld-bg-elevated)',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', pointerEvents: 'all',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--bld-bg-elevated)', flexShrink: 0 }}>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--bld-text-2)' }}>Node JSON</span>
          <button
            onClick={handleCopy}
            style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', color: copyDone ? 'var(--bld-success)' : 'var(--bld-text-3)', cursor: 'pointer' }}
          >{copyDone ? '✓ Copied' : 'Copy'}</button>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
          >×</button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px' }}>
          <pre style={{ fontSize: 10, color: 'var(--bld-success)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, lineHeight: 1.5 }}>
            {json}
          </pre>
        </div>
      </div>
    </div>
  );
}

function SaveStatusBadge({ status }: { status: SaveStatus }) {
  if (status === 'saving') return (
    <span title="Saving…" style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginRight: 8, color: 'var(--bld-text-disabled)' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
          style={{ animation: 'spin 1s linear infinite', transformOrigin: '12px 12px' }}/>
      </svg>
    </span>
  );
  if (status === 'error') return (
    <span title="Save failed" style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginRight: 8, color: 'var(--bld-warning, #f59e0b)' }}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M8 2L14.5 13H1.5L8 2z"/><path d="M8 6.5v3M8 11v.5"/>
      </svg>
    </span>
  );
  return null;
}

/** Overlay tab buttons shown in the navbar (no Config Files — it lives in the left panel) */
const OVERLAY_TABS: Array<{ id: LeftTabId; label: string; icon: React.ReactNode }> = [
  {
    id: 'triggers', label: 'Triggers',
    icon: <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M8 1.5L3.5 7.5H7L5 13l6-8H8l0-3.5z" fill="currentColor"/></svg>,
  },
  {
    id: 'assets', label: 'Assets',
    icon: <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="2.5" width="11" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2" fill="none"/><circle cx="5" cy="5.5" r="1.1" fill="currentColor"/><path d="M1.5 9.5L4.5 6.5 7 9 9.5 6.5 12.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
  },
];

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
  workspaceId,
  workspacePlan,
  superAdmin,
  aiRefreshKey,
  fileExplorerOpen,
  setFileExplorerOpen,
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
  workspaceId: string | null;
  workspacePlan: 'FREE' | 'PRO' | 'ENTERPRISE';
  superAdmin: boolean;
  aiRefreshKey: number;
  fileExplorerOpen: boolean;
  setFileExplorerOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  const [jsonPanelOpen, setJsonPanelOpen] = useState(false);

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
          setExportOpen(true);
        } else {
          setExportPaywall({ price: res.price, message: res.message });
        }
      }
    } catch (err) {
      setExportPaywallError((err as Error).message ?? 'Export not available');
      setExportPaywall({ price: -1, message: '' });
    } finally {
      setExportPaywallLoading(false);
    }
  }

  // ── More menu (three-dots) state ─────────────────────────────────────────
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreOpen]);

  const iconBtn: React.CSSProperties = {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: '1px solid transparent', borderRadius: 5,
    color: 'var(--bld-text-disabled)', cursor: 'pointer', transition: 'all 0.15s',
  };

  return (
    <>
    <div
      style={{
        height: 46,
        display: 'flex',
        alignItems: 'center',
        backgroundColor: 'var(--bld-glass-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--bld-glass-border)',
        padding: '0 10px',
        gap: 4,
        position: 'relative',
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      {/* ── LEFT: three-dots + edit controls + panel tabs ─────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>

        {/* Three-dots — far left */}
        <div ref={moreRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setMoreOpen(o => !o)} title="More options"
            style={{ ...iconBtn, color: moreOpen ? 'var(--bld-text-2)' : 'var(--bld-text-disabled)', background: moreOpen ? 'var(--bld-bg-elevated)' : 'transparent', border: `1px solid ${moreOpen ? 'rgba(255,255,255,0.1)' : 'transparent'}` }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={e => { if (!moreOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; e.currentTarget.style.borderColor = 'transparent'; } }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
          </button>
          {moreOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 200, zIndex: 500,
              background: 'var(--bld-popup-bg)',
              border: '1px solid var(--bld-glass-border)',
              borderRadius: 12, boxShadow: 'var(--bld-shadow-lg)',
              padding: '6px 0', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            }}>
              {/* Back to workspaces */}
              {projectId && (
                <>
                  <a href="/workspaces"
                    style={{
                      width: '100%', textAlign: 'left', background: 'none', border: 'none',
                      padding: '7px 14px', fontSize: 12, color: 'var(--bld-text-2)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bld-bg-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12L6 8l4-4"/></svg>
                    Back to workspaces
                  </a>
                  <div style={{ height: 1, background: 'var(--bld-border)', margin: '5px 0' }} />
                </>
              )}
              {([
                { testId: 'btn-export', icon: <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3H13C13.6 3 14 3.4 14 4V13C14 13.6 13.6 14 13 14H3C2.4 14 2 13.6 2 13V4C2 3.4 2.4 3 3 3H6M8 1V9M6 3L8 1L10 3"/></svg>, label: 'Export', onClick: () => { setMoreOpen(false); handleExportClick(); }, disabled: exportPaywallLoading, danger: false },
              ] as const).map(item => (
                <button key={item.testId} data-testid={item.testId} onClick={item.onClick} disabled={item.disabled}
                  style={{
                    width: '100%', textAlign: 'left', background: 'none', border: 'none',
                    padding: '7px 14px', fontSize: 12, color: 'var(--bld-text-2)', cursor: 'pointer',
                    opacity: item.disabled ? 0.45 : 1, display: 'flex', alignItems: 'center', gap: 9, transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bld-bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >{item.icon}{item.label}</button>
              ))}
              <div style={{ height: 1, background: 'var(--bld-border)', margin: '5px 0' }} />
              <div style={{ padding: '5px 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--bld-text-2)' }}>Builder theme</span>
                <BuilderThemeToggle />
              </div>
              <div style={{ height: 1, background: 'var(--bld-border)', margin: '5px 0' }} />
              {/* Logout */}
              <button
                data-testid="navbar-logout-btn"
                onClick={async () => { setMoreOpen(false); await auth.logout(); window.location.href = '/login'; }}
                style={{
                  width: '100%', textAlign: 'left', background: 'none', border: 'none',
                  padding: '7px 14px', fontSize: 12, color: 'var(--bld-error, #f87171)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 9, transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M10 11l3-3-3-3M13 8H6"/></svg>
                Logout
              </button>
            </div>
          )}
        </div>

        {mainMode === 'interface' && (
          <>
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.07)', margin: '0 2px' }} />
            <TopBarBtn disabled={!canUndo} onClick={undo} title="Undo (⌘Z)" testId="btn-undo">↩</TopBarBtn>
            <TopBarBtn disabled={!canRedo} onClick={redo} title="Redo (⌘⇧Z)" testId="btn-redo">↪</TopBarBtn>
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.07)', margin: '0 2px' }} />
            <PagesPicker onOpenPageConfig={onOpenPageConfig} />
            <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.07)', margin: '0 2px' }} />
            {/* Triggers · Assets · Auth · Env — tight group */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {OVERLAY_TABS.map(btn => {
                const isActive = leftTab === btn.id;
                return (
                  <button key={btn.id} data-testid={`navbar-tab-${btn.id}`}
                    onClick={() => onSetLeftTab(isActive ? 'components' : btn.id)}
                    title={btn.label}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 8px',
                      background: isActive ? 'rgba(99,102,241,0.18)' : 'transparent',
                      border: `1px solid ${isActive ? 'rgba(99,102,241,0.45)' : 'transparent'}`,
                      borderRadius: 7,
                      color: isActive ? 'var(--bld-accent-fg)' : 'var(--bld-text-disabled)',
                      cursor: 'pointer', fontSize: 11, fontWeight: isActive ? 500 : 400,
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; } }}
                  >
                    {btn.icon}
                    {btn.label}
                  </button>
                );
              })}
              <button
                data-testid="navbar-auth-btn"
                onClick={onOpenAuthConfig}
                title="Auth Settings"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
                  background: 'transparent', border: '1px solid transparent',
                  borderRadius: 7, color: 'var(--bld-text-disabled)',
                  cursor: 'pointer', fontSize: 11, fontWeight: 400, transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/></svg>
                Auth
              </button>
              <button
                data-testid="navbar-env-btn"
                onClick={() => setEnvVarsOpen(true)}
                title="Environment Variables"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
                  background: 'transparent', border: '1px solid transparent',
                  borderRadius: 7, color: 'var(--bld-text-disabled)',
                  cursor: 'pointer', fontSize: 11, fontWeight: 400, transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42"/></svg>
                Env
              </button>
              {/* Config Files — dev only */}
              {(() => {
                const isActive = fileExplorerOpen;
                return (
                  <button
                    data-testid="navbar-config-btn"
                    onClick={() => setFileExplorerOpen(v => !v)}
                    title="Config Files"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
                      background: isActive ? 'rgba(99,102,241,0.18)' : 'transparent',
                      border: `1px solid ${isActive ? 'rgba(99,102,241,0.45)' : 'transparent'}`,
                      borderRadius: 7,
                      color: isActive ? 'var(--bld-accent-fg)' : 'var(--bld-text-disabled)',
                      cursor: 'pointer', fontSize: 11, fontWeight: isActive ? 500 : 400, transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; } }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M10 2v3h3"/>
                    </svg>
                    Files
                  </button>
                );
              })()}
              {/* JSON viewer — shows selected node's JSON */}
              {(() => {
                const isActive = jsonPanelOpen;
                return (
                  <button
                    data-testid="navbar-json-btn"
                    onClick={() => setJsonPanelOpen(v => !v)}
                    title="View selected node JSON"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
                      background: isActive ? 'rgba(99,102,241,0.18)' : 'transparent',
                      border: `1px solid ${isActive ? 'rgba(99,102,241,0.45)' : 'transparent'}`,
                      borderRadius: 7,
                      color: isActive ? 'var(--bld-accent-fg)' : 'var(--bld-text-disabled)',
                      cursor: 'pointer', fontSize: 11, fontWeight: isActive ? 500 : 400, transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--bld-text-disabled)'; } }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="10 2 14 8 10 14"/><polyline points="6 2 2 8 6 14"/>
                    </svg>
                    JSON
                  </button>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* ── CENTER: mode switcher (absolutely centered) ────────────────── */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 1, background: 'var(--bld-bg-elevated)', borderRadius: 8, padding: '3px' }}>
        {([
          { id: 'interface' as const, label: 'Interface' },
          { id: 'data-api'  as const, label: 'Data & API' },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => onMainModeChange(tab.id)} title={tab.label}
            style={{
              padding: '4px 14px', fontSize: 11, fontWeight: mainMode === tab.id ? 600 : 400,
              color: mainMode === tab.id ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)',
              background: mainMode === tab.id ? 'var(--bld-bg-input)' : 'transparent',
              border: 'none', borderRadius: 6, cursor: 'pointer', transition: 'all 0.13s',
              boxShadow: mainMode === tab.id ? 'var(--bld-shadow-sm)' : 'none',
            }}
            onMouseEnter={e => { if (mainMode !== tab.id) e.currentTarget.style.color = 'var(--bld-text-3)'; }}
            onMouseLeave={e => { if (mainMode !== tab.id) e.currentTarget.style.color = 'var(--bld-text-disabled)'; }}
          >{tab.label}</button>
        ))}
      </div>

      {/* ── RIGHT: action buttons + save indicator ─────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'flex-end', minWidth: 0 }}>

        {/* AI token meter */}
        {workspaceId && (
          <AiTokenMeter
            workspaceId={workspaceId}
            plan={workspacePlan}
            superAdmin={superAdmin}
            refreshKey={aiRefreshKey}
          />
        )}

        {/* Save indicator */}
        <SaveStatusBadge status={saveStatus} />

        {/* AI button */}
        <button data-testid="btn-ai-mode" onClick={toggleAiMode} title={aiMode ? 'Close AI' : 'Open AI Assistant'}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px',
            background: aiMode
              ? 'linear-gradient(135deg, rgba(124,58,237,0.85), rgba(99,102,241,0.85))'
              : 'var(--bld-bg-elevated)',
            border: `1px solid ${aiMode ? 'rgba(124,58,237,0.5)' : 'var(--bld-border)'}`,
            borderRadius: 8,
            color: aiMode ? '#fff' : 'var(--bld-text-2)',
            cursor: 'pointer', fontSize: 11, fontWeight: 500, transition: 'all 0.15s',
            boxShadow: aiMode ? '0 2px 12px rgba(124,58,237,0.3)' : 'none',
          }}
          onMouseEnter={e => { if (!aiMode) { e.currentTarget.style.background = 'var(--bld-bg-input)'; e.currentTarget.style.color = 'var(--bld-text-1)'; } }}
          onMouseLeave={e => { if (!aiMode) { e.currentTarget.style.background = 'var(--bld-bg-elevated)'; e.currentTarget.style.color = 'var(--bld-text-2)'; } }}
        >
          {/* 4-point sparkle */}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2C8 2 8.6 5.4 10 6.5 11.4 7.6 14 8 14 8 14 8 11.4 8.4 10 9.5 8.6 10.6 8 14 8 14 8 14 7.4 10.6 6 9.5 4.6 8.4 2 8 2 8Z"/>
          </svg>
          AI
        </button>

        {/* Preview */}
        <button data-testid="btn-preview" onClick={canPreview ? onPreview : undefined} disabled={!canPreview} title={previewTooltip}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 11px',
            background: canPreview ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${canPreview ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'}`,
            borderRadius: 8, color: canPreview ? 'var(--bld-text-2)' : 'var(--bld-text-disabled)',
            cursor: canPreview ? 'pointer' : 'not-allowed',
            fontSize: 11, fontWeight: 500, opacity: canPreview ? 1 : 0.5, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (canPreview) { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'var(--bld-text-1)'; } }}
          onMouseLeave={e => { if (canPreview) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'var(--bld-text-2)'; } }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z"/><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none"/></svg>
          Preview
        </button>

        {/* Deploy */}
        {projectId && (
          <button data-testid="btn-deploy" onClick={() => setDeployOpen(true)} title="Deploy your app"
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 13px',
              background: deployPublished
                ? 'linear-gradient(135deg, rgba(5,150,105,0.9), rgba(4,120,87,0.9))'
                : 'linear-gradient(135deg, rgba(99,102,241,0.95), rgba(79,70,229,0.95))',
              border: `1px solid ${deployPublished ? 'rgba(5,150,105,0.5)' : 'rgba(99,102,241,0.45)'}`,
              borderRadius: 8, color: '#fff', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
              boxShadow: deployPublished ? '0 0 10px rgba(5,150,105,0.25)' : '0 0 10px rgba(99,102,241,0.2)',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            {deployPublished ? (
              <>
                {/* pulse dot */}
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'inline-block', boxShadow: '0 0 6px rgba(74,222,128,0.9)' }} />
                Live
              </>
            ) : (
              <>
                {/* cloud-upload */}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12H3.5C2.1 12 1 10.9 1 9.5C1 8.3 1.9 7.3 3 7.1C2.9 6.8 3 6.4 3 6C3 4.3 4.3 3 6 3C6.6 3 7.2 3.2 7.7 3.5C8.3 2.6 9.4 2 10.5 2C12.4 2 14 3.6 14 5.5C14 5.7 14 5.8 13.9 6C14.6 6.4 15 7.1 15 8C15 9.1 14.1 10 13 10H11"/>
                  <path d="M8 7V14M6 9.5L8 7L10 9.5"/>
                </svg>
                Deploy
              </>
            )}
          </button>
        )}

      </div>

    </div>

    {/* ── Modals — rendered outside navbar to avoid backdropFilter stacking context ── */}
    {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}
    <EnvVarsPanel projectId={projectId ?? ''} open={envVarsOpen} onClose={() => setEnvVarsOpen(false)} />
    {jsonPanelOpen && <NodeJsonPanel onClose={() => setJsonPanelOpen(false)} />}

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

    </>
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
  const [mainMode, setMainMode] = useState<'interface' | 'data-api'>(() => {
    if (typeof window === 'undefined') return 'interface';
    const saved = sessionStorage.getItem('bld:mainMode');
    return (saved === 'data-api' ? 'data-api' : 'interface') as 'interface' | 'data-api';
  });
  const [leftTab, setLeftTab] = useState<LeftTabId>('components');
  const [leftSlide, setLeftSlide] = useState<LeftSlideState>(null);
  const [leftSlideWidth, setLeftSlideWidth] = useState(320);
  const [fileExplorerOpen, setFileExplorerOpen] = useState(false);
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
  const isAdminMode = !projectId || projectId === 'admin';

  // Workspace info for the token meter
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspacePlan, setWorkspacePlan] = useState<'FREE' | 'PRO' | 'ENTERPRISE'>('FREE');
  const [superAdmin, setSuperAdmin] = useState(false);
  const [aiRefreshKey, setAiRefreshKey] = useState(0);

  useEffect(() => {
    if (!projectId || isAdminMode) return;
    projectsApi.get(projectId)
      .then(({ project }) => {
        setWorkspaceId(project.workspaceId);
        return Promise.all([
          workspacesApi.get(project.workspaceId),
          auth.me(),
        ]);
      })
      .then(([{ workspace }, { user }]) => {
        setWorkspacePlan(workspace.plan as 'FREE' | 'PRO' | 'ENTERPRISE');
        setSuperAdmin(user.superAdmin ?? false);
      })
      .catch(() => {});
  }, [projectId, isAdminMode]);

  // Bump aiRefreshKey after each AI turn so the token meter re-fetches usage
  useEffect(() => {
    const handler = () => setAiRefreshKey(k => k + 1);
    window.addEventListener('builder:ai-turn-done', handler);
    return () => window.removeEventListener('builder:ai-turn-done', handler);
  }, []);

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
    const { pageNodes, viewport, pages, currentPageId, themeOverrides, themeDarkOverrides, workflows, customVars, customColors, globalFormulas } = useBuilderStore.getState();
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
      workflows,
      customVars,
      customColors,
      sharedComponents: getSharedComponents(),
      formulas: globalFormulas,
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
        backgroundColor: 'var(--bld-bg-base)',
        backgroundImage: 'radial-gradient(ellipse 120% 80% at 50% -10%, rgba(99,102,241,0.07) 0%, transparent 55%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <TopBar
        onPreview={openPreview}
        saveStatus={saveStatus}
        projectId={projectId}
        mainMode={mainMode}
        onMainModeChange={(m) => { setMainMode(m); sessionStorage.setItem('bld:mainMode', m); }}
        leftTab={leftTab}
        onSetLeftTab={setLeftTab}
        onOpenAuthConfig={() => { setLeftSlideWidth(360); setLeftSlide({ kind: 'authConfig' }); }}
        onOpenPageConfig={() => { setLeftSlideWidth(320); setLeftSlide({ kind: 'pageConfig' }); }}
        workspaceId={workspaceId}
        workspacePlan={workspacePlan}
        superAdmin={superAdmin}
        aiRefreshKey={aiRefreshKey}
        fileExplorerOpen={fileExplorerOpen}
        setFileExplorerOpen={setFileExplorerOpen}
      />

      {/* ── Data & API full-screen view ────────────────────────────────────── */}
      {mainMode === 'data-api' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <DataApiTab projectId={projectId ?? ''} />
        </div>
      )}

      {mainMode === 'interface' && (
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <PanelLeft
          activeTab={leftTab}
          onTabChange={setLeftTab}
          isDevMode={true}
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

        {/* File Explorer Overlay — fixed, starts at left:0, covers the sidebar */}
        <FileExplorerOverlay open={fileExplorerOpen} onClose={() => setFileExplorerOpen(false)} projectId={projectId ?? undefined} />

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

      {/* File viewer drawer — right-side, opened from Files panel or AI chat */}
      <FileViewerDrawer />

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
