'use client';

/**
 * FileViewerDrawer — right-side drawer with three read-only tabs:
 *
 *  WebContainer       — raw TS/JSX files Claude wrote (useDslSourcesStore)
 *  Builder (Decompiled) — builder JSON state decompiled back to source
 *  Library            — live content of lib/dsl/builder/index.ts (fetched from /api/builder-source)
 *
 * File tree uses the same folder-tree structure as _files-panel.tsx.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { create } from 'zustand';
import { useDslSourcesStore } from './_dsl-sources-store';
import { useBuilderStore } from './_store';
import { decompileStore } from '@/lib/dsl/decompiler';
import { MonacoEditor } from './_monaco-editor';

// ── Drawer state ──────────────────────────────────────────────────────────────

export type DrawerTab = 'webcontainer' | 'builder' | 'library';

interface FileViewerDrawerState {
  isOpen: boolean;
  tab: DrawerTab;
  open: (tab?: DrawerTab) => void;
  close: () => void;
  setTab: (tab: DrawerTab) => void;
}

export const useFileViewerDrawer = create<FileViewerDrawerState>(set => ({
  isOpen: false,
  tab: 'webcontainer',
  open: (tab = 'webcontainer') => set({ isOpen: true, tab }),
  close: () => set({ isOpen: false }),
  setTab: (tab) => set({ tab }),
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const BG_PANEL   = '#1e1e1e';
const BG_SIDEBAR = '#252526';
const BG_HEADER  = '#2d2d2d';
const BORDER     = '#3c3c3c';
const TEXT_1     = '#d4d4d4';
const TEXT_2     = '#9ca3af';
const TEXT_DIM   = '#6b7280';
const ACCENT     = '#6366f1';

const FILE_COLORS: Record<string, string> = {
  ts: '#3178C6', tsx: '#61DAFB', js: '#F7DF1E',
  jsx: '#61DAFB', json: '#A8FF78', css: '#264DE4', md: '#aaa',
};

function extToMonacoLang(ext: string): string {
  if (ext === 'tsx' || ext === 'jsx') return 'typescript';
  if (ext === 'ts') return 'typescript';
  if (ext === 'js') return 'javascript';
  if (ext === 'json') return 'json';
  if (ext === 'css') return 'css';
  if (ext === 'md') return 'markdown';
  return 'plaintext';
}

// ── File tree types & builder ─────────────────────────────────────────────────

interface TreeFile   { kind: 'file';   name: string; path: string }
interface TreeFolder { kind: 'folder'; name: string; path: string; children: TreeNode[] }
type TreeNode = TreeFile | TreeFolder;

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', children: [] };
  for (const filePath of paths) {
    const parts = filePath.split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part   = parts[i]!;
      const isLast = i === parts.length - 1;
      const segPath = parts.slice(0, i + 1).join('/');
      if (isLast) {
        cur.children.push({ kind: 'file', name: part, path: filePath });
      } else {
        let folder = cur.children.find(c => c.kind === 'folder' && c.name === part) as TreeFolder | undefined;
        if (!folder) {
          folder = { kind: 'folder', name: part, path: segPath, children: [] };
          cur.children.push(folder);
        }
        cur = folder;
      }
    }
  }
  // Sort: folders before files, alphabetically within each group
  function sort(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach(n => { if (n.kind === 'folder') sort(n.children); });
  }
  sort(root.children);
  return root.children;
}

// ── File icon ─────────────────────────────────────────────────────────────────

function FileIcon({ ext }: { ext: string }) {
  const color = FILE_COLORS[ext] ?? TEXT_2;
  const glyph = ext === 'tsx' || ext === 'jsx' ? '⚛'
              : ext === 'ts' || ext === 'js' ? 'JS'
              : ext === 'json' ? '{}'
              : ext === 'css' ? '#'
              : '•';
  return (
    <span style={{ fontSize: 9, fontWeight: 700, color, fontFamily: 'monospace', width: 14, textAlign: 'center', flexShrink: 0 }}>
      {glyph}
    </span>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={open ? '#e2c08d' : '#c8a96e'} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {open
        ? <><path d="M1 4a1 1 0 011-1h4l1.5 1.5H14a1 1 0 011 1V12a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/></>
        : <><path d="M1 4a1 1 0 011-1h4l1.5 1.5H14a1 1 0 011 1V12a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/></>
      }
    </svg>
  );
}

// ── Tree node row (read-only) ─────────────────────────────────────────────────

function TreeNodeRow({
  node, depth, activeTab, onOpen, openFolders, toggleFolder,
}: {
  node: TreeNode; depth: number; activeTab: string | null;
  onOpen: (path: string) => void;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
}) {
  const paddingLeft = 8 + depth * 14;

  if (node.kind === 'folder') {
    const isOpen = openFolders.has(node.path);
    return (
      <>
        <div
          onClick={() => toggleFolder(node.path)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: `3px 8px 3px ${paddingLeft}px`,
            cursor: 'pointer', userSelect: 'none',
            color: TEXT_2,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ flexShrink: 0, transition: 'transform 0.1s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: TEXT_DIM }}>
            <path d="M2 1l4 3-4 3V1z"/>
          </svg>
          <FolderIcon open={isOpen} />
          <span style={{ fontSize: 12, color: TEXT_2 }}>{node.name}</span>
        </div>
        {isOpen && node.children.map(child => (
          <TreeNodeRow key={child.path} node={child} depth={depth + 1} activeTab={activeTab} onOpen={onOpen} openFolders={openFolders} toggleFolder={toggleFolder} />
        ))}
      </>
    );
  }

  const ext      = node.name.split('.').pop() ?? '';
  const isActive = node.path === activeTab;
  return (
    <div
      onClick={() => onOpen(node.path)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: `3px 8px 3px ${paddingLeft}px`,
        cursor: 'pointer', userSelect: 'none',
        background: isActive ? 'rgba(99,102,241,0.15)' : 'none',
        borderLeft: `2px solid ${isActive ? ACCENT : 'transparent'}`,
        color: isActive ? TEXT_1 : TEXT_2,
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none'; }}
    >
      <FileIcon ext={ext} />
      <span style={{ fontSize: 12, color: isActive ? FILE_COLORS[ext] ?? TEXT_1 : TEXT_2 }}>{node.name}</span>
    </div>
  );
}

// ── Tab content (file tree + Monaco) ─────────────────────────────────────────

function TabContent({ sources }: { sources: Record<string, string> }) {
  const paths = useMemo(() => Object.keys(sources).sort(), [sources]);
  const tree  = useMemo(() => buildTree(paths), [paths]);
  const [activeTab, setActiveTab]   = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  // Auto-expand all folders and select first file
  useEffect(() => {
    const folders = new Set<string>();
    function collect(nodes: TreeNode[]) {
      for (const n of nodes) { if (n.kind === 'folder') { folders.add(n.path); collect(n.children); } }
    }
    collect(tree);
    setOpenFolders(folders);
    if (paths.length > 0 && (!activeTab || !sources[activeTab])) {
      setActiveTab(paths[0] ?? null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.length]);

  const toggleFolder = useCallback((path: string) => {
    setOpenFolders(prev => { const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  }, []);

  const activeContent = activeTab ? (sources[activeTab] ?? '') : '';
  const activeExt     = activeTab?.split('.').pop() ?? '';
  const monacoLang    = extToMonacoLang(activeExt);
  const fileColor     = FILE_COLORS[activeExt] ?? TEXT_2;

  if (paths.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG_PANEL, color: TEXT_DIM, fontSize: 12, flexDirection: 'column', gap: 6 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span>No files yet</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: BG_PANEL }}>
      {/* File tree sidebar */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: `1px solid ${BORDER}`,
        overflow: 'auto', display: 'flex', flexDirection: 'column',
        background: BG_SIDEBAR,
      }}>
        <div style={{ padding: '6px 10px 4px', fontSize: 9.5, fontWeight: 700, color: TEXT_DIM, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
          Files
        </div>
        {tree.map(node => (
          <TreeNodeRow key={node.path} node={node} depth={0} activeTab={activeTab} onOpen={setActiveTab} openFolders={openFolders} toggleFolder={toggleFolder} />
        ))}
      </div>

      {/* Monaco editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {activeTab && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 14px', borderBottom: `1px solid ${BORDER}`,
            background: BG_HEADER, flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: fileColor, fontFamily: 'monospace', textTransform: 'uppercase' }}>
              {activeExt}
            </span>
            <span style={{ fontSize: 11.5, color: TEXT_1, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeTab}
            </span>
            <span style={{ fontSize: 9.5, color: TEXT_DIM, flexShrink: 0 }}>
              {activeContent.split('\n').length} lines
            </span>
          </div>
        )}
        {activeTab ? (
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <MonacoEditor
              key={activeTab}
              height="100%"
              language={monacoLang}
              value={activeContent}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                fontSize: 12.5,
                lineHeight: 20,
                fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
                fontLigatures: true,
                wordWrap: 'off',
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                padding: { top: 8, bottom: 8 },
                folding: true,
                bracketPairColorization: { enabled: true },
                stickyScroll: { enabled: true },
              }}
            />
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG_PANEL, color: TEXT_DIM, fontSize: 12 }}>
            Select a file
          </div>
        )}
      </div>
    </div>
  );
}

// ── Library tab ───────────────────────────────────────────────────────────────

function LibraryTab() {
  const [source, setSource] = useState<string>('');

  useEffect(() => {
    fetch('/api/builder-source')
      .then(r => r.text())
      .then(setSource)
      .catch(() => {});
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: BG_PANEL }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 14px', borderBottom: `1px solid ${BORDER}`,
        background: BG_HEADER, flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#3178C6', fontFamily: 'monospace', textTransform: 'uppercase' }}>TS</span>
        <span style={{ fontSize: 11.5, color: TEXT_1, fontWeight: 500, flex: 1 }}>builder.ts</span>
        <span style={{ fontSize: 9.5, color: TEXT_DIM, flexShrink: 0 }}>
          {source ? `${source.split('\n').length} lines · read-only` : 'Loading…'}
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <MonacoEditor
          key="builder-library"
          height="100%"
          language="typescript"
          value={source}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            fontSize: 12.5,
            lineHeight: 20,
            fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
            fontLigatures: true,
            wordWrap: 'off',
            lineNumbers: 'on',
            folding: true,
            bracketPairColorization: { enabled: true },
            stickyScroll: { enabled: true },
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────

export function FileViewerDrawer() {
  const { isOpen, tab, close, setTab } = useFileViewerDrawer();
  const wcSources    = useDslSourcesStore(s => s.sources);
  const builderStore = useBuilderStore();

  const decompiled = useMemo(() => {
    if (!isOpen || tab !== 'builder') return {};
    return decompileStore(builderStore);
  }, [isOpen, tab, builderStore]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close();
  }, [close]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  const tabBtn = (t: DrawerTab, label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        padding: '8px 14px', fontSize: 11.5, fontWeight: 600,
        background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
        borderBottom: `2px solid ${tab === t ? ACCENT : 'transparent'}`,
        color: tab === t ? TEXT_1 : TEXT_DIM,
        fontFamily: 'inherit', transition: 'color 120ms',
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      {isOpen && (
        <div
          onClick={handleBackdropClick}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9998 }}
        />
      )}

      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '58vw', minWidth: 600, maxWidth: 1000,
          background: BG_PANEL,
          borderLeft: `1px solid ${BORDER}`,
          boxShadow: '-6px 0 32px rgba(0,0,0,0.5)',
          zIndex: 9999,
          display: 'flex', flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'stretch',
          padding: '0 12px 0 14px',
          borderBottom: `1px solid ${BORDER}`,
          background: BG_HEADER,
          flexShrink: 0,
          gap: 4,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: TEXT_1, display: 'flex', alignItems: 'center', paddingRight: 10, borderRight: `1px solid ${BORDER}`, marginRight: 4 }}>
            Files
          </span>
          {tabBtn('webcontainer', 'WebContainer')}
          {tabBtn('builder', 'Builder (Decompiled)')}
          {tabBtn('library', 'Library')}
          <div style={{ flex: 1 }} />
          <button
            onClick={close}
            title="Close (Esc)"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: TEXT_DIM, padding: '4px 2px', display: 'flex', alignItems: 'center',
              borderRadius: 4,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = TEXT_1; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = TEXT_DIM; }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Description */}
        <div style={{ padding: '4px 14px', background: BG_SIDEBAR, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <span style={{ fontSize: 10.5, color: TEXT_DIM }}>
            {tab === 'webcontainer'
              ? 'Source files Claude wrote in the WebContainer filesystem'
              : tab === 'builder'
                ? 'Builder store decompiled back to TypeScript/JSX — compare with WebContainer to verify alignment'
                : 'The builder DSL library source Claude reads to understand component syntax, sx props, workflows, and vars'}
          </span>
        </div>

        {/* Content */}
        {tab === 'webcontainer' && <TabContent sources={wcSources} />}
        {tab === 'builder'      && <TabContent sources={decompiled} />}
        {tab === 'library'      && <LibraryTab />}
      </div>
    </>
  );
}
