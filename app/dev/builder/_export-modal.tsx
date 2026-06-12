'use client';

/**
 * _export-modal.tsx — Export project as standalone React code.
 *
 * Runs the codegen pipeline in-browser, formats with prettier,
 * zips, and triggers a download.
 */

import { useState, useCallback, useRef } from 'react';
import { useBuilderStore } from './_store';

interface ExportModalProps {
  onClose: () => void;
}

type ExportPhase =
  | 'idle'
  | 'planning'
  | 'codegen'
  | 'formatting'
  | 'zipping'
  | 'done'
  | 'error';

interface ProgressState {
  phase: ExportPhase;
  filesDone: number;
  filesTotal: number;
  error?: string;
  errorNodeId?: string;
}

export function ExportModal({ onClose }: ExportModalProps) {
  const store = useBuilderStore.getState();
  const projectAppName = (store as unknown as Record<string, unknown>).projectAppName as string | undefined;

  const [appName, setAppName] = useState(projectAppName ?? 'my-app');
  const [progress, setProgress] = useState<ProgressState>({
    phase: 'idle',
    filesDone: 0,
    filesTotal: 0,
  });
  const [fileTree, setFileTree] = useState<string[]>([]);
  const abortRef = useRef(false);

  const handleExport = useCallback(async () => {
    abortRef.current = false;
    setProgress({ phase: 'planning', filesDone: 0, filesTotal: 0 });
    setFileTree([]);

    try {
      // Dynamic imports to avoid bloating the main bundle
      setProgress(p => ({ ...p, phase: 'codegen' }));
      const { codegenProject, formatAllFiles, createZip, downloadBlob } = await import(
        '@/lib/builder/codegen'
      );

      const state = useBuilderStore.getState();
      const rawFiles = codegenProject(state, { appName: appName.trim() || 'my-app' });
      setFileTree(rawFiles.map(f => f.path));
      setProgress(p => ({ ...p, filesTotal: rawFiles.length, filesDone: rawFiles.length }));

      if (abortRef.current) return;

      setProgress(p => ({ ...p, phase: 'formatting' }));
      const formattedFiles = await formatAllFiles(rawFiles);

      if (abortRef.current) return;

      setProgress(p => ({ ...p, phase: 'zipping' }));
      const zipName = (appName.trim() || 'my-app').replace(/\s+/g, '-');
      const blob = await createZip(formattedFiles, zipName, (done, total) => {
        setProgress(p => ({ ...p, filesDone: done, filesTotal: total }));
      });

      if (abortRef.current) return;

      downloadBlob(blob, `${zipName}.zip`);
      setProgress(p => ({ ...p, phase: 'done' }));
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // Try to extract node id from error message
      const nodeIdMatch = msg.match(/node ['""]([^'""\]]+)['""]/) || msg.match(/\(([^)]+)\)/);
      setProgress(p => ({
        ...p,
        phase: 'error',
        error: msg,
        errorNodeId: nodeIdMatch?.[1],
      }));
    }
  }, [appName]);

  const isRunning = progress.phase !== 'idle' && progress.phase !== 'done' && progress.phase !== 'error';
  const isDone = progress.phase === 'done';
  const isError = progress.phase === 'error';

  const phaseLabel: Record<ExportPhase, string> = {
    idle: 'Ready',
    planning: 'Planning symbol map…',
    codegen: 'Generating code…',
    formatting: 'Formatting with Prettier…',
    zipping: 'Creating ZIP…',
    done: 'Done!',
    error: 'Export failed',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 12,
        padding: 28,
        width: 540,
        maxWidth: '90vw',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--bld-text-1)' }}>Export as React Code</div>
            <div style={{ fontSize: 12, color: 'var(--bld-text-3)', marginTop: 2 }}>
              Downloads a standalone Next.js + Tailwind project
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--bld-text-3)', fontSize: 18, cursor: 'pointer', padding: '4px 8px' }}
          >
            ✕
          </button>
        </div>

        {/* App name input */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            App Name
          </label>
          <input
            value={appName}
            onChange={e => setAppName(e.target.value)}
            disabled={isRunning}
            placeholder="my-app"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 6,
              padding: '8px 12px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 6,
              color: 'var(--bld-text-1)',
              fontSize: 13,
              fontFamily: 'monospace',
              boxSizing: 'border-box',
              outline: 'none',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
            onBlur={e => (e.currentTarget.style.borderColor = '#334155')}
          />
        </div>

        {/* Progress */}
        {progress.phase !== 'idle' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: isError ? '#f87171' : isDone ? '#10b981' : '#60a5fa',
              }}>
                {phaseLabel[progress.phase]}
              </span>
              {progress.filesTotal > 0 && (
                <span style={{ fontSize: 11, color: 'var(--bld-text-3)' }}>
                  {progress.filesDone} / {progress.filesTotal} files
                </span>
              )}
            </div>
            {!isError && (
              <div style={{ height: 4, background: '#1e3a5f', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  background: isDone ? '#10b981' : '#3b82f6',
                  borderRadius: 2,
                  width: isDone ? '100%' : progress.filesTotal > 0
                    ? `${Math.round((progress.filesDone / progress.filesTotal) * 100)}%`
                    : '30%',
                  transition: 'width 0.2s ease',
                }} />
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {isError && progress.error && (
          <div style={{
            background: '#450a0a',
            border: '1px solid #7f1d1d',
            borderRadius: 6,
            padding: 12,
            fontSize: 11,
            color: '#fca5a5',
            fontFamily: 'monospace',
            lineHeight: 1.5,
            maxHeight: 120,
            overflowY: 'auto',
          }}>
            {progress.error}
            {progress.errorNodeId && (
              <div style={{ marginTop: 6, color: '#f87171' }}>
                Node: <strong>{progress.errorNodeId}</strong>
              </div>
            )}
          </div>
        )}

        {/* File tree preview */}
        {fileTree.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bld-text-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Generated Files ({fileTree.length})
            </div>
            <div style={{
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: 6,
              padding: '8px 10px',
              maxHeight: 160,
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: 11,
              color: 'var(--bld-text-3)',
              lineHeight: 1.8,
            }}>
              {fileTree.map(f => (
                <div key={f} style={{ color: f.endsWith('.tsx') ? '#818cf8' : f.endsWith('.ts') ? '#60a5fa' : f.endsWith('.css') ? '#34d399' : '#94a3b8' }}>
                  {f}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Success */}
        {isDone && (
          <div style={{
            background: '#052e16',
            border: '1px solid #14532d',
            borderRadius: 6,
            padding: 12,
            fontSize: 12,
            color: '#86efac',
            textAlign: 'center',
          }}>
            ✓ Downloaded! Run <code style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 3, padding: '1px 5px' }}>npm install && npm run dev</code> to get started.
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={isRunning}
            style={{
              padding: '8px 16px',
              background: 'none',
              border: '1px solid #334155',
              borderRadius: 6,
              color: 'var(--bld-text-3)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'system-ui',
            }}
          >
            {isDone ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handleExport}
            disabled={isRunning}
            style={{
              padding: '8px 20px',
              background: isRunning ? '#1e3a5f' : '#1d4ed8',
              border: 'none',
              borderRadius: 6,
              color: isRunning ? '#64748b' : '#fff',
              fontSize: 12,
              fontWeight: 700,
              cursor: isRunning ? 'not-allowed' : 'pointer',
              fontFamily: 'system-ui',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'background 0.15s',
            }}
          >
            {isRunning && (
              <span style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                border: '2px solid #60a5fa',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }} />
            )}
            {isRunning ? 'Exporting…' : isDone ? '↓ Download Again' : '↓ Export ZIP'}
          </button>
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
