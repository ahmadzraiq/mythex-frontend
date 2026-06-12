'use client';

/**
 * Builder Files Panel
 *
 * Presents the builder store as a virtual file tree mirroring the config/
 * folder structure. Clicking a leaf opens it in the JSON editor.
 *
 * Used as the "files" tab in the left panel.
 */

import React, { useState, useMemo, useCallback, lazy, Suspense, useRef, useEffect } from 'react';
import { useBuilderStore } from './_store';
import type { BuilderStore } from './_store-types';
import {
  buildFileTree,
  readVirtualFile,
  applyVirtualFile,
  type VirtualEntry,
  type VirtualFile,
  type VirtualFolder,
} from './_virtual-files';
import { json as cmJson } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

const CodeMirror = lazy(() => import('@uiw/react-codemirror'));

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms', flexShrink: 0 }}
    >
      <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon({ icon }: { icon: VirtualFile['icon'] }) {
  switch (icon) {
    case 'page':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1.5" y="1" width="7" height="10" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <path d="M3.5 4h3.5M3.5 6h3.5M3.5 8h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
      );
    case 'routes':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <path d="M1.5 6h9M6 1.5c-1.5 1.5-1.5 7.5 0 9M6 1.5c1.5 1.5 1.5 7.5 0 9" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      );
    case 'data':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <ellipse cx="6" cy="3.5" rx="3.5" ry="1.3" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <path d="M2.5 3.5v2.5c0 .72 1.57 1.3 3.5 1.3s3.5-.58 3.5-1.3V3.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <path d="M2.5 6v2.5c0 .72 1.57 1.3 3.5 1.3s3.5-.58 3.5-1.3V6" stroke="currentColor" strokeWidth="1.1" fill="none" />
        </svg>
      );
    case 'theme':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <circle cx="4.5" cy="4.5" r="1" fill="currentColor" />
          <circle cx="7.5" cy="4.5" r="1" fill="currentColor" />
          <circle cx="4.5" cy="7.5" r="1" fill="currentColor" />
          <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
        </svg>
      );
    case 'variable':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 4l2 2-2 2M6 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'formula':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 9l2-6 2 4 1.5-2.5H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'workflow':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="2.5" cy="6" r="1.2" fill="currentColor" />
          <circle cx="9.5" cy="3" r="1.2" fill="currentColor" />
          <circle cx="9.5" cy="9" r="1.2" fill="currentColor" />
          <path d="M3.7 6l3.3-3M3.7 6l3.3 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
      );
    case 'trigger':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M7 1.5L4 6.5h3.5L5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'component':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1.5" y="4.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <rect x="6.5" y="4.5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <rect x="4" y="1.5" width="4" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" />
        </svg>
      );
    case 'group':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect x="1.5" y="2.5" width="9" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <path d="M1.5 5h9" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case 'color':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
          <circle cx="6" cy="5.5" r="1.2" fill="currentColor" />
          <path d="M6 9v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d={open
          ? 'M1 4.5h10v5.5a1 1 0 01-1 1H2a1 1 0 01-1-1V4.5zM1 4.5V3a1 1 0 011-1h2.5l1 1.5H11a0 0 0 010 0V4.5'
          : 'M1 3a1 1 0 011-1h2.5l1 1.5H11a1 1 0 011 1v5.5a1 1 0 01-1 1H2a1 1 0 01-1-1V3z'}
        stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── FileTreeRow ──────────────────────────────────────────────────────────────

interface FileTreeRowProps {
  entry: VirtualEntry;
  depth: number;
  openPath: string | null;
  onOpen: (path: string) => void;
}

function FileTreeRow({ entry, depth, openPath, onOpen }: FileTreeRowProps) {
  const [expanded, setExpanded] = useState(false);

  if (entry.kind === 'folder') {
    return (
      <>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            width: '100%', padding: `3px 8px 3px ${8 + depth * 14}px`,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--bld-text-2)', fontSize: 11,
            textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--bld-text-disabled)', display: 'flex' }}>
            <IconChevron open={expanded} />
          </span>
          <span style={{ display: 'flex', color: 'var(--bld-text-disabled)' }}>
            <FolderIcon open={expanded} />
          </span>
          <span style={{ fontWeight: 500 }}>{entry.name}</span>
        </button>
        {expanded && (entry as VirtualFolder).children.map(child => (
          <FileTreeRow
            key={child.path}
            entry={child}
            depth={depth + 1}
            openPath={openPath}
            onOpen={onOpen}
          />
        ))}
      </>
    );
  }

  // file leaf
  const isActive = openPath === entry.path;
  return (
    <button
      onClick={() => onOpen(entry.path)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        width: '100%', padding: `3px 8px 3px ${8 + depth * 14 + 14}px`,
        background: isActive ? 'var(--bld-accent-hover)' : 'none',
        border: 'none', cursor: 'pointer',
        color: isActive ? 'var(--bld-accent-fg)' : 'var(--bld-text-2)',
        fontSize: 11, textAlign: 'left',
        borderRadius: isActive ? 4 : 0,
      }}
    >
      <span style={{ display: 'flex', opacity: 0.7 }}>
        <FileIcon icon={(entry as VirtualFile).icon} />
      </span>
      {entry.name}
    </button>
  );
}

// ─── JsonEditor ───────────────────────────────────────────────────────────────

interface JsonEditorProps {
  path: string;
  store: BuilderStore;
  onClose: () => void;
}

function JsonEditor({ path, store, onClose }: JsonEditorProps) {
  const [draftJson, setDraftJson] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [canvasChanged, setCanvasChanged] = useState(false);
  const lastSavedRef = useRef<string>('');

  // Load file content when path changes
  useEffect(() => {
    const content = readVirtualFile(store, path);
    setDraftJson(content);
    lastSavedRef.current = content;
    setIsDirty(false);
    setParseError(null);
    setApplyError(null);
    setCanvasChanged(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Detect canvas-side changes while we have unsaved edits
  useEffect(() => {
    if (!isDirty) return;
    const current = readVirtualFile(store, path);
    if (current !== lastSavedRef.current) {
      setCanvasChanged(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.pages, store.themeOverrides, store.customVars, store.pageDataSources, store.globalFormulas]);

  const handleChange = useCallback((val: string) => {
    setDraftJson(val);
    setIsDirty(val !== lastSavedRef.current);
    setApplyError(null);
    // Validate JSON live
    try {
      JSON.parse(val);
      setParseError(null);
    } catch (e) {
      setParseError((e as Error).message);
    }
  }, []);

  const handleApply = useCallback(() => {
    if (parseError) return;
    const result = applyVirtualFile(store, path, draftJson);
    if (result.ok) {
      lastSavedRef.current = draftJson;
      setIsDirty(false);
      setApplyError(null);
      setCanvasChanged(false);
    } else {
      setApplyError(result.error ?? 'Unknown error');
    }
  }, [store, path, draftJson, parseError]);

  const handleRevert = useCallback(() => {
    const content = readVirtualFile(store, path);
    setDraftJson(content);
    lastSavedRef.current = content;
    setIsDirty(false);
    setParseError(null);
    setApplyError(null);
    setCanvasChanged(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, path]);

  const handleReloadFromCanvas = useCallback(() => {
    const content = readVirtualFile(store, path);
    lastSavedRef.current = content;
    setDraftJson(content);
    setIsDirty(false);
    setCanvasChanged(false);
    setParseError(null);
    setApplyError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, path]);

  const fileName = path.split('/').pop() + '.json';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bld-bg-1)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 8px', borderBottom: '1px solid var(--bld-bg-input)',
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          title="Back to file tree"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--bld-text-disabled)', padding: '2px 4px', borderRadius: 3,
            display: 'flex', alignItems: 'center',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M7.5 2L3.5 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ fontSize: 11, color: 'var(--bld-text-1)', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </span>
        {isDirty && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--bld-accent)', flexShrink: 0 }} title="Unsaved changes" />
        )}
      </div>

      {/* Canvas-changed warning */}
      {canvasChanged && (
        <div style={{
          padding: '6px 8px', background: 'rgba(234, 179, 8, 0.12)',
          borderBottom: '1px solid rgba(234, 179, 8, 0.3)',
          fontSize: 11, color: '#ca8a04',
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1L1 10h10L6 1z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <path d="M6 5v2.5M6 9v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span style={{ flex: 1 }}>Canvas changed. Unsaved edits below.</span>
          <button
            onClick={handleReloadFromCanvas}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ca8a04', fontSize: 11, padding: 0, textDecoration: 'underline' }}
          >
            Reload
          </button>
        </div>
      )}

      {/* Error display */}
      {(parseError || applyError) && (
        <div style={{
          padding: '5px 8px', background: 'rgba(239, 68, 68, 0.1)',
          borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
          fontSize: 10, color: '#ef4444', flexShrink: 0,
          fontFamily: 'monospace',
        }}>
          {parseError ?? applyError}
        </div>
      )}

      {/* CodeMirror */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Suspense fallback={
          <div style={{ padding: 12, color: 'var(--bld-text-disabled)', fontSize: 11 }}>Loading editor…</div>
        }>
          <CodeMirror
            value={draftJson}
            extensions={[cmJson()]}
            theme={oneDark}
            onChange={handleChange}
            style={{ fontSize: 11, height: '100%' }}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        </Suspense>
      </div>

      {/* Footer actions */}
      <div style={{
        display: 'flex', gap: 6, padding: '6px 8px',
        borderTop: '1px solid var(--bld-bg-input)', flexShrink: 0,
      }}>
        <button
          onClick={handleApply}
          disabled={!isDirty || !!parseError}
          style={{
            flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600,
            background: isDirty && !parseError ? 'var(--bld-accent)' : 'var(--bld-bg-input)',
            color: isDirty && !parseError ? 'var(--bld-accent-fg)' : 'var(--bld-text-disabled)',
            border: 'none', borderRadius: 5, cursor: isDirty && !parseError ? 'pointer' : 'not-allowed',
          }}
        >
          Apply
        </button>
        <button
          onClick={handleRevert}
          disabled={!isDirty}
          style={{
            padding: '5px 10px', fontSize: 11,
            background: 'none', border: '1px solid var(--bld-bg-input)',
            color: isDirty ? 'var(--bld-text-2)' : 'var(--bld-text-disabled)',
            borderRadius: 5, cursor: isDirty ? 'pointer' : 'not-allowed',
          }}
        >
          Revert
        </button>
      </div>
    </div>
  );
}

// ─── FilesPanel ───────────────────────────────────────────────────────────────

export function FilesPanel() {
  const store = useBuilderStore();
  const [openPath, setOpenPath] = useState<string | null>(null);

  const tree = useMemo(
    () => buildFileTree(store),
    // rebuild when pages, datasources, workflows change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.pages, store.pageDataSources, store.globalWorkflowMeta, store.pageWorkflowMeta, store.customVars, store.globalFormulas],
  );

  if (openPath !== null) {
    return (
      <JsonEditor
        path={openPath}
        store={store}
        onClose={() => setOpenPath(null)}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Panel header */}
      <div style={{
        padding: '7px 8px 5px',
        fontSize: 10, fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase',
        color: 'var(--bld-text-disabled)',
        borderBottom: '1px solid var(--bld-bg-input)',
        flexShrink: 0,
      }}>
        Config Files
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {tree.children.map(entry => (
          <FileTreeRow
            key={entry.path}
            entry={entry}
            depth={0}
            openPath={openPath}
            onOpen={setOpenPath}
          />
        ))}
      </div>
    </div>
  );
}
