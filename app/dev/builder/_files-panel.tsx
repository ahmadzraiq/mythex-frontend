'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useDslSourcesStore } from './_dsl-sources-store';
import { useFileViewerDrawer } from './_file-viewer-drawer';
import { useBuilderStore } from './_store';
import { decompileStore } from '@/lib/dsl/decompiler';
import { MonacoEditor } from './_monaco-editor';
import { compileAllAndApply } from './_use-webcontainer-dsl';

// ─── File tree builder ────────────────────────────────────────────────────────

type TreeFile   = { kind: 'file';   name: string; path: string };
type TreeFolder = { kind: 'folder'; name: string; path: string; children: TreeNode[] };
type TreeNode   = TreeFile | TreeFolder;

/** File names hidden from the tree UI (they only exist to anchor empty folders). */
const HIDDEN_FILES = new Set(['.gitkeep']);

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', children: [] };
  for (const filePath of paths) {
    const parts = filePath.split('/');
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      const segPath = parts.slice(0, i + 1).join('/');
      if (isLast) {
        // Skip hidden placeholder files but keep their parent folders
        if (!HIDDEN_FILES.has(part)) {
          cur.children.push({ kind: 'file', name: part, path: filePath });
        }
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
  function sort(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(n => n.kind === 'folder' ? { ...n, children: sort(n.children) } : n);
  }
  return sort(root.children);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FILE_COLORS: Record<string, string> = {
  tsx: '#61dafb', ts: '#3178c6', jsx: '#f7df1e', js: '#f7df1e',
  json: '#ffa500', css: '#cc6699', md: '#8b9dc3',
};

function extToMonacoLang(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', css: 'css', md: 'markdown', html: 'html',
  };
  return map[ext] ?? 'plaintext';
}

function defaultContentForPath(path: string): string {
  const ext = path.split('.').pop() ?? '';
  if (ext === 'tsx' || ext === 'jsx') {
    const name = path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Component';
    const pascal = name.charAt(0).toUpperCase() + name.slice(1);
    return `import { Box, Text } from 'builder';\n\nexport default function ${pascal}() {\n  return (\n    <Box sx={{ p: 4 }}>\n      <Text>${pascal}</Text>\n    </Box>\n  );\n}\n`;
  }
  if (ext === 'ts') return `// ${path}\n`;
  if (ext === 'json') return '{\n  \n}\n';
  if (ext === 'css') return `/* ${path} */\n`;
  return '';
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function FolderIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1 4a1 1 0 011-1h4.586a1 1 0 01.707.293L8 4h6a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" fill="#e8c547" opacity=".9"/>
      <path d="M1 7h14" stroke="#e8c547" strokeWidth="1.2" opacity=".4"/>
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1 4a1 1 0 011-1h4.586a1 1 0 01.707.293L8 4h6a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4z" fill="#c8a830" opacity=".7"/>
    </svg>
  );
}

function FileIcon({ ext }: { ext: string }) {
  const color = FILE_COLORS[ext] ?? '#8b9dc3';
  if (ext === 'tsx' || ext === 'jsx') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <rect x="2" y="1" width="10" height="14" rx="1" fill={color} opacity=".15" stroke={color} strokeWidth="1"/>
        <text x="4" y="11" fontSize="7" fontWeight="700" fill={color} fontFamily="monospace">R</text>
      </svg>
    );
  }
  if (ext === 'ts' || ext === 'js') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <rect x="2" y="1" width="10" height="14" rx="1" fill={color} opacity=".15" stroke={color} strokeWidth="1"/>
        <text x="3.5" y="11" fontSize="7" fontWeight="700" fill={color} fontFamily="monospace">{ext === 'ts' ? 'TS' : 'JS'}</text>
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 1h7l4 4v10H3V1z" fill="none" stroke={color} strokeWidth="1" opacity=".6"/>
      <path d="M10 1v4h4" stroke={color} strokeWidth="1" opacity=".4"/>
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
      style={{ flexShrink: 0, transition: 'transform 0.12s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
      <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── Inline rename input ──────────────────────────────────────────────────────

function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(false);
  const valRef = useRef(initial);
  valRef.current = val;

  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const commit = useCallback(() => {
    if (committed.current) return;
    committed.current = true;
    onCommit(valRef.current.trim());
  }, [onCommit]);

  return (
    <input
      ref={ref}
      value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        e.stopPropagation();
      }}
      onBlur={commit}
      onClick={e => e.stopPropagation()}
      style={{
        flex: 1, background: '#3c3c3c', border: '1px solid #6366f1', borderRadius: 2,
        color: '#d4d4d4', fontSize: 12, padding: '1px 4px', outline: 'none',
      }}
    />
  );
}

// ─── New file/folder input ────────────────────────────────────────────────────

function NewItemInput({ prefix, onCommit, onCancel, placeholder = 'filename.tsx', icon }: {
  prefix: string; onCommit: (path: string) => void; onCancel: () => void;
  placeholder?: string; icon?: React.ReactNode;
}) {
  const [val, setVal] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(false); // prevent double-fire from Enter + blur
  const valRef = useRef('');
  valRef.current = val;

  useEffect(() => {
    // Use rAF so the input is in the DOM before focusing
    const id = requestAnimationFrame(() => { ref.current?.focus(); });
    return () => cancelAnimationFrame(id);
  }, []);

  const commit = useCallback(() => {
    if (committed.current) return;
    const trimmed = valRef.current.trim();
    if (!trimmed) { onCancel(); return; }
    committed.current = true;
    const full = prefix ? `${prefix}/${trimmed}` : trimmed;
    onCommit(full);
  }, [prefix, onCommit, onCancel]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '3px 8px 3px 18px', gap: 5 }}>
      {icon}
      {prefix && <span style={{ fontSize: 10, color: '#6b7280', flexShrink: 0 }}>{prefix}/</span>}
      <input
        ref={ref}
        value={val}
        placeholder={placeholder}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          e.stopPropagation();
        }}
        onBlur={commit}
        style={{
          flex: 1, background: '#3c3c3c', border: '1px solid #6366f1', borderRadius: 2,
          color: '#d4d4d4', fontSize: 12, padding: '2px 5px', outline: 'none', minWidth: 0,
        }}
      />
    </div>
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

type CtxMenu = { x: number; y: number; path: string; kind: 'file' | 'folder' };

function ContextMenu({ menu, onRename, onDelete, onNewFile, onNewFolder, onClose }: {
  menu: CtxMenu;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const item = (label: string, icon: string, action: () => void, danger = false) => (
    <button onClick={() => { action(); onClose(); }} style={{
      display: 'flex', alignItems: 'center', gap: 7,
      width: '100%', padding: '5px 12px', background: 'none', border: 'none',
      cursor: 'pointer', textAlign: 'left', fontSize: 12,
      color: danger ? '#f87171' : '#d4d4d4',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.07)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
    >
      <span style={{ fontSize: 13 }}>{icon}</span>{label}
    </button>
  );

  return (
    <div ref={ref} style={{
      position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999,
      background: '#252526', border: '1px solid #3e3e3e', borderRadius: 6,
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)', minWidth: 170, padding: '3px 0',
    }}>
      {menu.kind === 'folder' && item('New File Here', '📄', onNewFile)}
      {menu.kind === 'folder' && item('New Folder Here', '📁', onNewFolder)}
      {item('Rename', '✏️', onRename)}
      {item('Delete', '🗑️', onDelete, true)}
    </div>
  );
}

// ─── Tree node row ────────────────────────────────────────────────────────────

function TreeNodeRow({
  node, depth, activeTab, onOpen, openFolders, toggleFolder,
  renamingPath, onRenameCommit, onRenameCancel,
  newItemParent, onNewItemCommit, onNewItemCancel,
  onContextMenu,
}: {
  node: TreeNode; depth: number; activeTab: string | null;
  onOpen: (path: string) => void;
  openFolders: Set<string>; toggleFolder: (path: string) => void;
  renamingPath: string | null;
  onRenameCommit: (oldPath: string, newName: string) => void;
  onRenameCancel: () => void;
  newItemParent: string | null;
  onNewItemCommit: (path: string) => void;
  onNewItemCancel: () => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
}) {
  const indent = depth * 12 + 6;

  if (node.kind === 'folder') {
    const isOpen = openFolders.has(node.path);
    return (
      <>
        <button
          onContextMenu={e => onContextMenu(e, node)}
          onClick={() => toggleFolder(node.path)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            width: '100%', padding: `2px 6px 2px ${indent}px`,
            background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
            color: 'var(--bld-text-2)',
          }}>
          <ChevronIcon open={isOpen} />
          <FolderIcon open={isOpen} />
          {renamingPath === node.path ? (
            <RenameInput
              initial={node.name}
              onCommit={v => onRenameCommit(node.path, v)}
              onCancel={onRenameCancel}
            />
          ) : (
            <span style={{ fontSize: 12, fontWeight: 500, userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {node.name}
            </span>
          )}
        </button>
        {isOpen && (
          <>
            {node.children.map(child => (
              <TreeNodeRow key={child.path} node={child} depth={depth + 1} activeTab={activeTab}
                onOpen={onOpen} openFolders={openFolders} toggleFolder={toggleFolder}
                renamingPath={renamingPath} onRenameCommit={onRenameCommit} onRenameCancel={onRenameCancel}
                newItemParent={newItemParent} onNewItemCommit={onNewItemCommit} onNewItemCancel={onNewItemCancel}
                onContextMenu={onContextMenu}
              />
            ))}
            {newItemParent === node.path && (
              <NewItemInput prefix={node.path} placeholder="filename.tsx" onCommit={onNewItemCommit} onCancel={onNewItemCancel} />
            )}
          </>
        )}
      </>
    );
  }

  const ext = node.name.split('.').pop() ?? '';
  const isActive = node.path === activeTab;

  return (
    <button
      onContextMenu={e => onContextMenu(e, node)}
      onDoubleClick={() => {/* double-click to rename handled via context menu */}}
      onClick={() => onOpen(node.path)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        width: '100%', padding: `2px 6px 2px ${indent + 14}px`,
        background: isActive ? 'rgba(99,102,241,0.18)' : 'none',
        border: isActive ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
        borderRadius: 3, cursor: 'pointer', textAlign: 'left',
        color: isActive ? '#e2e8f0' : '#cccccc',
      }}>
      <FileIcon ext={ext} />
      {renamingPath === node.path ? (
        <RenameInput
          initial={node.name}
          onCommit={v => onRenameCommit(node.path, v)}
          onCancel={onRenameCancel}
        />
      ) : (
        <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {node.name}
        </span>
      )}
    </button>
  );
}

// ─── Main IDE panel ───────────────────────────────────────────────────────────

function SourceFilesPanel({
  baseSources, onSourcesChange, projectId,
}: {
  /** Canonical sources from outside (AI WebContainer files or decompiled builder state). */
  baseSources: Record<string, string>;
  onSourcesChange: (next: Record<string, string>) => void;
  projectId?: string;
}) {
  // User edits live in localSources. When baseSources changes (builder canvas edit),
  // we merge: baseSources provides new/updated files, user edits for existing files win.
  const [localSources, setLocalSources] = useState<Record<string, string>>(baseSources);
  const dirtyPaths = useRef<Set<string>>(new Set()); // paths the user has manually edited
  // Paths the user created/renamed/deleted explicitly — never auto-removed by baseSources sync
  const persistedPaths = useRef<Set<string>>(new Set());

  // Sync baseSources → localSources for files that haven't been manually edited/created
  useEffect(() => {
    setLocalSources(prev => {
      const merged: Record<string, string> = { ...baseSources };
      // Keep user edits and user-created files regardless of baseSources
      for (const path of dirtyPaths.current) {
        if (prev[path] !== undefined) merged[path] = prev[path]!;
      }
      for (const path of persistedPaths.current) {
        if (prev[path] !== undefined) merged[path] = prev[path]!;
      }
      // Remove files deleted externally — but never remove user-persisted paths
      for (const path of Object.keys(prev)) {
        const isUserOwned = dirtyPaths.current.has(path) || persistedPaths.current.has(path);
        if (!baseSources[path] && !isUserOwned) delete merged[path];
      }
      return merged;
    });
  }, [baseSources]);

  const sources = localSources;

  const filePaths = useMemo(() => Object.keys(sources), [sources]);
  const tree      = useMemo(() => buildTree(filePaths), [filePaths]);

  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [newItemParent, setNewItemParent] = useState<string | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [compileStatus, setCompileStatus] = useState<'idle' | 'compiling' | 'ok' | 'error'>('idle');

  const compileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allFolderPaths = useMemo(() => {
    const paths = new Set<string>();
    function collect(nodes: TreeNode[]) {
      for (const n of nodes) { if (n.kind === 'folder') { paths.add(n.path); collect(n.children); } }
    }
    collect(tree);
    return paths;
  }, [tree]);

  useEffect(() => { setOpenFolders(new Set(allFolderPaths)); }, [allFolderPaths]);

  // Auto-open first file
  useEffect(() => {
    if (filePaths.length > 0 && openTabs.length === 0) {
      const first = filePaths.find(p => !HIDDEN_FILES.has(p.split('/').pop() ?? '')) ?? filePaths[0]!;
      setOpenTabs([first]);
      setActiveTab(first);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePaths.length]);

  const toggleFolder = useCallback((path: string) => {
    setOpenFolders(prev => { const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  }, []);

  const openFile = useCallback((path: string) => {
    setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path]);
    setActiveTab(path);
  }, []);

  const closeTab = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const next = prev.filter(p => p !== path);
      setActiveTab(cur => {
        if (cur !== path) return cur;
        const idx = prev.indexOf(path);
        return next[Math.min(idx, next.length - 1)] ?? null;
      });
      return next;
    });
  }, []);

  // Compile sources → builder with debounce
  const triggerCompile = useCallback((newSources: Record<string, string>) => {
    if (compileTimer.current) clearTimeout(compileTimer.current);
    setCompileStatus('idle');
    compileTimer.current = setTimeout(() => {
      setCompileStatus('compiling');
      compileAllAndApply(newSources, projectId)
        .then(() => {
          dirtyPaths.current.clear();
          setCompileStatus('ok');
          setTimeout(() => setCompileStatus('idle'), 1500);
        })
        .catch(() => setCompileStatus('error'));
    }, 500);
  }, [projectId]);

  // Commit a source change: update local state, notify parent, compile
  const commitChange = useCallback((next: Record<string, string>, changedPaths?: string[]) => {
    setLocalSources(next);
    onSourcesChange(next);
    if (changedPaths) changedPaths.forEach(p => dirtyPaths.current.add(p));
    triggerCompile(next);
  }, [onSourcesChange, triggerCompile]);

  // Monaco content change
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeTab || value === undefined) return;
    commitChange({ ...sources, [activeTab]: value }, [activeTab]);
  }, [activeTab, sources, commitChange]);

  // ── File operations ──────────────────────────────────────────────────────────

  const createFile = useCallback((path: string) => {
    if (!path) return;
    const content = defaultContentForPath(path);
    persistedPaths.current.add(path);
    commitChange({ ...sources, [path]: content }, [path]);
    setOpenTabs(prev => [...prev, path]);
    setActiveTab(path);
    setNewItemParent(null);
    setNewFolderParent(null);
  }, [sources, commitChange]);

  const createFolder = useCallback((folderName: string) => {
    if (!folderName) { setNewFolderParent(null); return; }
    const name = folderName.replace(/\/+$/, '');
    const parent = newFolderParent;
    const fullPath = parent ? `${parent}/${name}` : name;
    const keepPath = `${fullPath}/.gitkeep`;
    // Mark the .gitkeep as persisted so the sync effect never deletes it
    persistedPaths.current.add(keepPath);
    // Don't trigger compilation for empty placeholder files — just update local state
    setLocalSources(prev => ({ ...prev, [keepPath]: '' }));
    onSourcesChange({ ...sources, [keepPath]: '' });
    setOpenFolders(prev => new Set([...prev, fullPath]));
    setNewFolderParent(null);
  }, [newFolderParent, sources, onSourcesChange]);

  const deleteFile = useCallback((path: string) => {
    const next = { ...sources };
    const toDelete = Object.keys(next).filter(p => p === path || p.startsWith(path + '/'));
    toDelete.forEach(p => {
      delete next[p];
      dirtyPaths.current.delete(p);
      persistedPaths.current.delete(p);
    });
    commitChange(next);
    setOpenTabs(prev => prev.filter(p => !toDelete.includes(p)));
    setActiveTab(prev => toDelete.includes(prev ?? '') ? (Object.keys(next).find(p => !HIDDEN_FILES.has(p.split('/').pop() ?? '')) ?? null) : prev);
  }, [sources, commitChange]);

  const renameItem = useCallback((oldPath: string, newName: string) => {
    if (!newName || newName === oldPath.split('/').pop()) { setRenamingPath(null); return; }
    const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = dir ? `${dir}/${newName}` : newName;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(sources)) {
      if (k === oldPath) next[newPath] = v;
      else if (k.startsWith(oldPath + '/')) next[newPath + k.slice(oldPath.length)] = v;
      else next[k] = v;
    }
    // Update dirty + persisted tracking
    if (dirtyPaths.current.has(oldPath)) { dirtyPaths.current.delete(oldPath); dirtyPaths.current.add(newPath); }
    if (persistedPaths.current.has(oldPath)) { persistedPaths.current.delete(oldPath); persistedPaths.current.add(newPath); }
    // Also update any nested .gitkeep paths under a renamed folder
    for (const p of [...persistedPaths.current]) {
      if (p.startsWith(oldPath + '/')) { persistedPaths.current.delete(p); persistedPaths.current.add(newPath + p.slice(oldPath.length)); }
    }
    commitChange(next, [newPath]);
    setOpenTabs(prev => prev.map(p => p === oldPath ? newPath : p.startsWith(oldPath + '/') ? newPath + p.slice(oldPath.length) : p));
    setActiveTab(prev => prev === oldPath ? newPath : prev);
    setRenamingPath(null);
  }, [sources, commitChange]);

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, path: node.path, kind: node.kind });
  }, []);

  const visiblePaths = filePaths.filter(p => !HIDDEN_FILES.has(p.split('/').pop() ?? ''));

  if (visiblePaths.length === 0 && newItemParent === null && newFolderParent === null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#1e1e1e' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
        </svg>
        <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', lineHeight: 1.6 }}>
          No files yet.<br/>
          <button onClick={() => setNewItemParent('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6366f1', fontSize: 12, padding: 0, marginTop: 4 }}>
            + Create a file
          </button>
        </div>
      </div>
    );
  }

  const activeContent = activeTab ? (sources[activeTab] ?? '') : '';
  const activeExt     = activeTab?.split('.').pop() ?? '';
  const monacoLang    = extToMonacoLang(activeExt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#1e1e1e' }}>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: 0 }}>

        {/* ── File tree ───────────────────────────────────── */}
        <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #2d2d2d', background: '#252526' }}>
          {/* Tree header */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '5px 8px 3px', borderBottom: '1px solid #2d2d2d', flexShrink: 0 }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1, userSelect: 'none' }}>
              Files
            </span>
            {/* New File button */}
            <button
              title="New File"
              onClick={() => { setNewItemParent(''); setNewFolderParent(null); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '2px 3px', borderRadius: 3, display: 'flex' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#d4d4d4'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.background = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z"/>
                <path d="M9 2v4h4"/><path d="M8 8v4M6 10h4"/>
              </svg>
            </button>
            {/* New Folder button */}
            <button
              title="New Folder"
              onClick={() => { setNewFolderParent(''); setNewItemParent(null); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: '2px 3px', borderRadius: 3, display: 'flex' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#d4d4d4'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.background = 'none'; }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4a1 1 0 011-1h4.586a1 1 0 01.707.293L8 4h6a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V4z"/>
                <path d="M11 7v4M9 9h4"/>
              </svg>
            </button>
          </div>

          {/* Tree nodes */}
          <div style={{ flex: 1, overflowY: 'auto', paddingTop: 2, paddingBottom: 8 }}>
            {newItemParent === '' && (
              <NewItemInput prefix="" onCommit={createFile} onCancel={() => setNewItemParent(null)} />
            )}
            {newFolderParent === '' && (
              <NewItemInput
                prefix="" placeholder="folder-name"
                icon={<FolderIcon open={false} />}
                onCommit={createFolder} onCancel={() => setNewFolderParent(null)}
              />
            )}
            {tree.map(node => (
              <TreeNodeRow key={node.path} node={node} depth={0} activeTab={activeTab}
                onOpen={openFile} openFolders={openFolders} toggleFolder={toggleFolder}
                renamingPath={renamingPath}
                onRenameCommit={renameItem} onRenameCancel={() => setRenamingPath(null)}
                newItemParent={newItemParent}
                onNewItemCommit={createFile} onNewItemCancel={() => setNewItemParent(null)}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        </div>

        {/* ── Editor area ─────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Tab bar */}
          {openTabs.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'stretch', overflowX: 'auto',
              background: '#252526', borderBottom: '1px solid #1e1e1e', flexShrink: 0, minHeight: 34,
              position: 'relative',
            }}>
              {openTabs.map(tabPath => {
                const isActive = tabPath === activeTab;
                const tabExt  = tabPath.split('.').pop() ?? '';
                const tabName = tabPath.split('/').pop() ?? tabPath;
                const tabColor = FILE_COLORS[tabExt] ?? '#9ca3af';
                return (
                  <div key={tabPath} onClick={() => setActiveTab(tabPath)} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0 10px 0 12px', cursor: 'pointer', flexShrink: 0,
                    background: isActive ? '#1e1e1e' : 'transparent',
                    borderTop: isActive ? '1px solid #6366f1' : '1px solid transparent',
                    borderRight: '1px solid #1e1e1e',
                    color: isActive ? '#d4d4d4' : '#9ca3af', fontSize: 12, whiteSpace: 'nowrap',
                  }}>
                    <FileIcon ext={tabExt} />
                    <span style={{ color: isActive ? tabColor : 'inherit' }}>{tabName}</span>
                    <button onClick={e => closeTab(tabPath, e)} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'transparent', padding: '1px 2px', borderRadius: 3,
                      fontSize: 12, lineHeight: 1, display: 'flex', alignItems: 'center', marginLeft: 2,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#d4d4d4'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'transparent'; e.currentTarget.style.background = 'none'; }}>
                      ✕
                    </button>
                  </div>
                );
              })}
              {/* Compile status badge */}
              {compileStatus !== 'idle' && (
                <div style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 10.5, fontWeight: 500, padding: '2px 7px', borderRadius: 10,
                  background: compileStatus === 'compiling' ? '#2d2d2d' : compileStatus === 'ok' ? '#1a3a2a' : '#3a1a1a',
                  color: compileStatus === 'compiling' ? '#9ca3af' : compileStatus === 'ok' ? '#4ade80' : '#f87171',
                  border: `1px solid ${compileStatus === 'compiling' ? '#3f3f46' : compileStatus === 'ok' ? '#166534' : '#7f1d1d'}`,
                  pointerEvents: 'none', whiteSpace: 'nowrap',
                }}>
                  {compileStatus === 'compiling' && '⟳ Saving…'}
                  {compileStatus === 'ok' && '✓ Saved'}
                  {compileStatus === 'error' && '✕ Compile error'}
                </div>
              )}
            </div>
          )}

          {/* Monaco */}
          {activeTab ? (
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <MonacoEditor
                key={activeTab}
                height="100%"
                language={monacoLang}
                value={activeContent}
                onChange={handleEditorChange}
                theme="vs-dark"
                options={{
                  readOnly: false,
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  fontSize: 12.5,
                  lineHeight: 20,
                  fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
                  fontLigatures: true,
                  wordWrap: 'off',
                  renderLineHighlight: 'line',
                  scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                  padding: { top: 8, bottom: 8 },
                  folding: true,
                  formatOnPaste: true,
                  formatOnType: true,
                  bracketPairColorization: { enabled: true },
                  stickyScroll: { enabled: true },
                  suggest: { showMethods: true, showFunctions: true, showVariables: true },
                  quickSuggestions: { other: true, comments: false, strings: true },
                }}
              />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e1e1e', color: '#4b5563', fontSize: 12 }}>
              Select a file
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          menu={ctxMenu}
          onRename={() => setRenamingPath(ctxMenu.path)}
          onDelete={() => deleteFile(ctxMenu.path)}
          onNewFile={() => {
            const parent = ctxMenu.kind === 'folder' ? ctxMenu.path : (ctxMenu.path.includes('/') ? ctxMenu.path.substring(0, ctxMenu.path.lastIndexOf('/')) : '');
            setNewItemParent(parent);
            setNewFolderParent(null);
            if (ctxMenu.kind === 'folder') setOpenFolders(prev => new Set([...prev, ctxMenu.path]));
          }}
          onNewFolder={() => {
            const parent = ctxMenu.kind === 'folder' ? ctxMenu.path : (ctxMenu.path.includes('/') ? ctxMenu.path.substring(0, ctxMenu.path.lastIndexOf('/')) : '');
            setNewFolderParent(parent);
            setNewItemParent(null);
            if (ctxMenu.kind === 'folder') setOpenFolders(prev => new Set([...prev, ctxMenu.path]));
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
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

  const setDslSources   = useDslSourcesStore(s => s.setSources);
  const setSharedSource = useDslSourcesStore(s => s.setSource);
  const builderStore    = useBuilderStore();

  // Always use decompiled builder state as the live base — reflects canvas edits instantly
  const baseSources = useMemo(
    () => decompileStore(builderStore),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [builderStore.pages, builderStore.customVars, builderStore.workflows],
  );

  const handleSourcesChange = useCallback((next: Record<string, string>) => {
    setDslSources(next);
    for (const [path, content] of Object.entries(next)) setSharedSource(path, content);
  }, [setDslSources, setSharedSource]);

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, top: TOPBAR_HEIGHT, background: 'rgba(0,0,0,0.45)', zIndex: 90 }} />
      <div style={{
        position: 'fixed', left: 0, top: TOPBAR_HEIGHT,
        width: 'min(880px, 78vw)', height: `calc(100vh - ${TOPBAR_HEIGHT}px)`,
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
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Explorer</span>
          <button onClick={onClose} title="Close (Esc)" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px',
            color: '#6b7280', borderRadius: 4, fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#d4d4d4'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#6b7280'; }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <SourceFilesPanel
            baseSources={baseSources}
            onSourcesChange={handleSourcesChange}
            projectId={projectId}
          />
        </div>
      </div>
    </>
  );
}

// ─── FilesPanelContent ────────────────────────────────────────────────────────

export function FilesPanelContent({ projectId }: { projectId?: string }) {
  const setDslSources   = useDslSourcesStore(s => s.setSources);
  const setSharedSource = useDslSourcesStore(s => s.setSource);
  const builderStore    = useBuilderStore();

  const baseSources = useMemo(
    () => decompileStore(builderStore),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [builderStore.pages, builderStore.customVars, builderStore.workflows],
  );

  const handleSourcesChange = useCallback((next: Record<string, string>) => {
    setDslSources(next);
    for (const [path, content] of Object.entries(next)) setSharedSource(path, content);
  }, [setDslSources, setSharedSource]);

  return (
    <SourceFilesPanel
      baseSources={baseSources}
      onSourcesChange={handleSourcesChange}
      projectId={projectId}
    />
  );
}

// ─── FilesPanel (compact sidebar) ────────────────────────────────────────────

export function FilesPanel() {
  const wcSources    = useDslSourcesStore(s => s.sources);
  const builderStore = useBuilderStore();
  const openDrawer   = useFileViewerDrawer(s => s.open);

  const hasWcSources = Object.keys(wcSources).length > 0;
  const hasAnySources = hasWcSources || (decompileStore(builderStore) && Object.keys(decompileStore(builderStore)).length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 10px', borderBottom: '1px solid var(--bld-border)', flexShrink: 0, background: 'var(--bld-bg-2)',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--bld-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Explorer</span>
        {hasAnySources && (
          <button onClick={() => openDrawer('webcontainer')} title="Compare" style={{
            display: 'flex', alignItems: 'center', background: 'none', border: 'none',
            cursor: 'pointer', padding: '2px 4px', color: 'var(--bld-text-disabled)', borderRadius: 3,
          }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="1" width="5" height="12" rx="1"/><rect x="8" y="1" width="5" height="12" rx="1"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
