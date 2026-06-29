'use client';

/**
 * VFS File Explorer — shows the virtual JSON file tree that the AI reads/writes.
 * Data is sourced from buildFileTree / readVirtualFile (_virtual-files.ts).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useBuilderStore } from './_store';
import { buildFileTree, readVirtualFile } from './_virtual-files';
import type { VirtualEntry, VirtualFolder, VirtualFile } from './_virtual-files';
import { fetchServerFiles, buildServerTree } from '@/lib/backend-vfs';

// ── Icon colours per VFS file type ────────────────────────────────────────────

const ICON_COLORS: Record<string, string> = {
  page:      '#61dafb',
  routes:    '#ffa500',
  data:      '#a78bfa',
  theme:     '#f472b6',
  variable:  '#34d399',
  formula:   '#fbbf24',
  workflow:  '#60a5fa',
  trigger:   '#f87171',
  component: '#c084fc',
  color:     '#fb923c',
};

function fileColor(icon: VirtualFile['icon']): string {
  return ICON_COLORS[icon] ?? '#9ca3af';
}

// ── File icon SVG ──────────────────────────────────────────────────────────────

function FileIcon({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
      <polyline points="9 2 9 6 13 6"/>
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#9ca3af" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {open
        ? <path d="M2 6.5A1.5 1.5 0 013.5 5h3L8 6.5h4.5A1.5 1.5 0 0114 8v4.5A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5V6.5z"/>
        : <path d="M2 4.5A1.5 1.5 0 013.5 3h3L8 5h4.5A1.5 1.5 0 0114 6.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 13V4.5z"/>}
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="9" height="9" viewBox="0 0 8 8" fill="currentColor"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s', flexShrink: 0 }}>
      <path d="M2 1l4 3-4 3V1z"/>
    </svg>
  );
}

// ── Tree node rendering ────────────────────────────────────────────────────────

function FolderNode({
  node, depth, selectedPath, onSelect, openFolders, toggleFolder,
}: {
  node: VirtualFolder;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
}) {
  const isOpen = openFolders.has(node.path);
  return (
    <div>
      <button
        onClick={() => toggleFolder(node.path)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          paddingLeft: 8 + depth * 12, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          color: '#9ca3af', fontSize: 11, textAlign: 'left',
          fontFamily: 'var(--font-mono, monospace)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
      >
        <ChevronIcon open={isOpen} />
        <FolderIcon open={isOpen} />
        <span>{node.name}</span>
      </button>
      {isOpen && node.children.map(child =>
        child.kind === 'folder'
          ? <FolderNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath}
              onSelect={onSelect} openFolders={openFolders} toggleFolder={toggleFolder} />
          : <FileNode key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
      )}
    </div>
  );
}

function FileNode({
  node, depth, selectedPath, onSelect,
}: {
  node: VirtualFile;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const isSelected = node.path === selectedPath;
  const color = fileColor(node.icon);
  return (
    <button
      onClick={() => onSelect(node.path)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        paddingLeft: 8 + depth * 12, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
        width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left',
        background: isSelected ? 'rgba(99,102,241,0.18)' : 'none',
        color: isSelected ? '#a5b4fc' : '#d4d4d4',
        fontSize: 11, fontFamily: 'var(--font-mono, monospace)',
        borderLeft: isSelected ? '2px solid #6366f1' : '2px solid transparent',
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'none'; }}
    >
      <FileIcon color={color} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
    </button>
  );
}

// ── VFS viewer (tree + JSON content pane) ─────────────────────────────────────

function VfsExplorer({ projectId }: { projectId?: string }) {
  const store = useBuilderStore();
  const frontendTree = buildFileTree(store);
  const [serverFiles, setServerFiles] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  // Merge the backend (server/*) projection so the unified VFS is visible.
  const tree: VirtualFolder = React.useMemo(() => {
    if (Object.keys(serverFiles).length === 0) return frontendTree;
    return { ...frontendTree, children: [...frontendTree.children, buildServerTree(serverFiles)] };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontendTree, serverFiles]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchServerFiles(projectId)
      .then((files) => { if (!cancelled) setServerFiles(files); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  // Auto-open top-level folders on mount
  useEffect(() => {
    const topLevel = new Set<string>(tree.children.map(c => c.path));
    setOpenFolders(topLevel);
    // Select the first file available
    function findFirstFile(entries: VirtualEntry[]): VirtualFile | null {
      for (const e of entries) {
        if (e.kind === 'file') return e;
        const found = findFirstFile(e.children);
        if (found) return found;
      }
      return null;
    }
    const first = findFirstFile(tree.children);
    if (first) setSelectedPath(first.path);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedPath) { setContent(''); return; }
    if (selectedPath.startsWith('server/')) {
      setContent(serverFiles[selectedPath] ?? '// Could not read file');
      return;
    }
    try {
      setContent(readVirtualFile(store, selectedPath));
    } catch {
      setContent('// Could not read file');
    }
  }, [selectedPath, store, serverFiles]);

  const toggleFolder = useCallback((path: string) => {
    setOpenFolders(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#1e1e1e' }}>
      {/* ── Left: file tree ── */}
      <div style={{
        width: 220, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid #2d2d2d',
        background: '#252526', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '7px 10px', borderBottom: '1px solid #2d2d2d',
          fontSize: 10, fontWeight: 700, color: '#6b7280',
          textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0,
        }}>
          Virtual Files
        </div>
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4, paddingBottom: 8 }}>
          {tree.children.map(child =>
            child.kind === 'folder'
              ? <FolderNode key={child.path} node={child} depth={0} selectedPath={selectedPath}
                  onSelect={setSelectedPath} openFolders={openFolders} toggleFolder={toggleFolder} />
              : <FileNode key={child.path} node={child} depth={0} selectedPath={selectedPath} onSelect={setSelectedPath} />
          )}
        </div>
      </div>

      {/* ── Right: JSON viewer ── */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {selectedPath && (
          <div style={{
            padding: '5px 12px', borderBottom: '1px solid #2d2d2d',
            background: '#2d2d2d', fontSize: 11, color: '#9ca3af',
            fontFamily: 'var(--font-mono, monospace)', flexShrink: 0,
          }}>
            {selectedPath}
          </div>
        )}
        <pre style={{
          flex: 1, margin: 0, padding: '12px 16px', overflow: 'auto',
          fontSize: 12, lineHeight: 1.55, color: '#d4d4d4',
          fontFamily: 'var(--font-mono, monospace)',
          background: '#1e1e1e', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {content || <span style={{ color: '#6b7280' }}>Select a file to view its JSON</span>}
        </pre>
      </div>
    </div>
  );
}

// ─── FileExplorerOverlay ──────────────────────────────────────────────────────

const TOPBAR_HEIGHT = 46;

export function FileExplorerOverlay({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId?: string }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, top: TOPBAR_HEIGHT, background: 'rgba(0,0,0,0.45)', zIndex: 90 }} />
      <div style={{
        position: 'fixed', left: 0, top: TOPBAR_HEIGHT,
        width: 'min(820px, 78vw)', height: `calc(100vh - ${TOPBAR_HEIGHT}px)`,
        zIndex: 91, display: 'flex', flexDirection: 'column',
        background: '#1e1e1e', boxShadow: '4px 0 32px rgba(0,0,0,0.6)',
        animation: 'fileExplorerSlideIn 0.18s cubic-bezier(0.2,0,0,1)',
      }}>
        <style>{`@keyframes fileExplorerSlideIn { from { transform: translateX(-100%); opacity: 0.4; } to { transform: translateX(0); opacity: 1; } }`}</style>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 14px', height: 36, flexShrink: 0,
          borderBottom: '1px solid #2d2d2d', background: '#252526',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>VFS Explorer</span>
          <button onClick={onClose} title="Close (Esc)" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px',
            color: '#6b7280', borderRadius: 4, fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#d4d4d4'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#6b7280'; }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <VfsExplorer projectId={projectId} />
        </div>
      </div>
    </>
  );
}

// ─── FilesPanelContent ────────────────────────────────────────────────────────

export function FilesPanelContent({ projectId }: { projectId?: string }) {
  return <VfsExplorer projectId={projectId} />;
}

// ─── FilesPanel (compact sidebar stub) ───────────────────────────────────────

export function FilesPanel() {
  return null;
}
