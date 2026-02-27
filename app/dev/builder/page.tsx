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
import { useBuilderStore, VIEWPORT_WIDTHS, type ViewportSize } from './_store';
import BuilderCanvas from './_canvas';
import PanelLeft from './_panel-left';
import PanelRight from './_panel-right';

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

function TopBar({ onPreview }: { onPreview: () => void }) {
  const { undo, redo, historyIdx, history, selectedIds, pageNodes, viewport, setViewport, pages, currentPageId, renamePage } = useBuilderStore();
  const canUndo = historyIdx > 0;
  const canRedo = historyIdx < history.length - 1;

  const currentPage = pages.find(p => p.id === currentPageId);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');

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

      {/* Page name + route */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={() => {
              if (currentPage && draftName.trim()) renamePage(currentPage.id, draftName.trim());
              setEditingName(false);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (currentPage && draftName.trim()) renamePage(currentPage.id, draftName.trim());
                setEditingName(false);
              }
              if (e.key === 'Escape') setEditingName(false);
            }}
            style={{ fontSize: 12, fontWeight: 600, color: '#f3f4f6', background: '#1f2937', border: '1px solid #3b82f6', borderRadius: 4, padding: '2px 8px', textAlign: 'center', width: 160 }}
          />
        ) : (
          <span
            style={{ fontSize: 12, fontWeight: 600, color: '#f3f4f6', cursor: 'default', padding: '0 8px' }}
            onDoubleClick={() => { setDraftName(currentPage?.name ?? ''); setEditingName(true); }}
            title="Double-click to rename"
          >
            {currentPage?.name ?? 'Untitled'}
          </span>
        )}
        {currentPage?.route && (
          <span style={{ fontSize: 9, color: '#4b5563', fontFamily: 'monospace', letterSpacing: '0.02em' }}>
            {currentPage.route}
          </span>
        )}
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

export default function BuilderPage() {
  const store = useBuilderStore();
  const initTheme = useBuilderStore(s => s.initTheme);

  // Install Gluestack primary token bridge immediately on mount so Checkbox,
  // Radio, Switch etc. reflect --primary even before a preset is applied.
  useEffect(() => { initTheme(); }, [initTheme]);

  // __builderStore is exposed at module level in _store.ts for E2E tests

  /** Serialize current page + active theme overrides to localStorage then open preview. */
  const openPreview = useCallback(() => {
    const { pageNodes, viewport, pages, currentPageId, themeOverrides, themeDarkOverrides } = useBuilderStore.getState();
    const currentPage = pages.find(p => p.id === currentPageId);
    localStorage.setItem(BUILDER_PREVIEW_KEY, JSON.stringify({
      nodes: pageNodes,
      viewport,
      pageName: currentPage?.name ?? 'Untitled',
      pageRoute: currentPage?.route ?? '/',
      themeOverrides,
      themeDarkOverrides,
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
        <PanelLeft />
        <BuilderCanvas />
        <PanelRight />
      </div>
    </div>
  );
}
