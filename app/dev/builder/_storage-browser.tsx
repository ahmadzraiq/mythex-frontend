'use client';
/**
 * Storage Browser — public/private bucket file manager.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { backendStorage, type BackendFileObject } from '@/lib/platform/api-client';

interface Props {
  projectId: string;
}

const MIME_ICONS: Record<string, string> = {
  'image/': '🖼',
  'video/': '🎥',
  'audio/': '🎵',
  'application/pdf': '📄',
  'text/': '📝',
  'application/json': '{ }',
};

function mimeIcon(mime: string): string {
  for (const [prefix, icon] of Object.entries(MIME_ICONS)) {
    if (mime.startsWith(prefix)) return icon;
  }
  return '📎';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StorageBrowser({ projectId }: Props) {
  const [bucket, setBucket]    = useState<'public' | 'private'>('private');
  const [files, setFiles]      = useState<BackendFileObject[]>([]);
  const [loading, setLoading]  = useState(true);
  const [selected, setSelected] = useState<BackendFileObject | null>(null);
  const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError]      = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backendStorage.list(projectId, bucket);
      setFiles(res.files);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, bucket]);

  useEffect(() => { void loadFiles(); }, [loadFiles]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const key = `${Date.now()}-${file.name}`;
      const presign = await backendStorage.presignUpload(projectId, { bucket, key, mime: file.type || 'application/octet-stream', sizeMb: file.size / (1024 * 1024) });
      await fetch(presign.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      await backendStorage.register(projectId, { bucket, key: presign.key, mime: file.type || 'application/octet-stream', size: file.size });
      await loadFiles();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openFile = async (file: BackendFileObject) => {
    setSelected(file);
    setPresignedUrl(null);
    try {
      const res = await backendStorage.getPresignedUrl(projectId, file.id);
      setPresignedUrl(res.url);
    } catch {
      setPresignedUrl(null);
    }
  };

  const deleteFile = async (fileId: string) => {
    if (!confirm('Delete this file?')) return;
    try {
      await backendStorage.delete(projectId, fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      if (selected?.id === fileId) setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative',
      background: 'var(--bld-bg-canvas)',
      backgroundImage: [
        'radial-gradient(ellipse 65% 45% at 80% 5%, rgba(59,130,246,0.07) 0%, transparent 60%)',
        'radial-gradient(ellipse 60% 40% at 10% 95%, rgba(124,58,237,0.07) 0%, transparent 55%)',
      ].join(', '),
    }}>
      {/* Glass toolbar */}
      <div style={{
        padding: '12px 20px', flexShrink: 0,
        background: 'var(--bld-glass-bg)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--bld-glass-border)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        {/* Bucket pills */}
        <div style={{ display: 'flex', background: 'var(--bld-bg-elevated)', borderRadius: 8, padding: 3, gap: 2 }}>
          {(['private', 'public'] as const).map((b) => {
            const active = bucket === b;
            return (
              <button
                key={b}
                onClick={() => { setBucket(b); setSelected(null); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 14px', fontSize: 11, fontWeight: active ? 600 : 400,
                  background: active ? 'rgba(59,130,246,0.18)' : 'transparent',
                  color: active ? '#93c5fd' : 'var(--bld-text-disabled)',
                  border: active ? '1px solid rgba(59,130,246,0.35)' : '1px solid transparent',
                  borderRadius: 6, cursor: 'pointer', transition: 'all 0.13s',
                }}
              >
                {b === 'private'
                  ? <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="4" y="7" width="8" height="7" rx="1"/><path d="M6 7V5a2 2 0 0 1 4 0v2"/></svg>
                  : <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><path d="M8 2a9 9 0 0 1 0 12"/></svg>
                }
                {b === 'private' ? 'Private' : 'Public'}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>
          {!loading && `${files.length} file${files.length !== 1 ? 's' : ''}`}
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 11, padding: '6px 16px', fontWeight: 600,
            background: uploading ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.15)',
            color: 'var(--bld-info)', border: '1px solid rgba(59,130,246,0.3)',
            borderRadius: 6, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.7 : 1,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="12" x2="8" y2="4"/><polyline points="4 7 8 3 12 7"/>
          </svg>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => void handleFileSelect(e)} />
      </div>

      {/* File list + detail */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* File grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {loading && (
            <div style={{ textAlign: 'center', color: 'var(--bld-text-disabled)', fontSize: 12, paddingTop: 60 }}>Loading…</div>
          )}
          {!loading && files.length === 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              paddingTop: 60, gap: 16,
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                boxShadow: '0 0 32px rgba(59,130,246,0.1)',
              }}>
                <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="#93c5fd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 4h8l2 2v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 0-1z"/>
                </svg>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--bld-text-2)', marginBottom: 6 }}>No files yet</div>
                <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)', lineHeight: 1.6 }}>
                  Click <strong style={{ color: 'var(--bld-text-3)' }}>Upload</strong> to add files to this bucket.
                </div>
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
              {files.map((file) => {
                const isSelected = selected?.id === file.id;
                return (
                  <div
                    key={file.id}
                    onClick={() => void openFile(file)}
                    style={{
                      background: isSelected ? 'rgba(59,130,246,0.1)' : 'var(--bld-bg-panel)',
                      border: `1px solid ${isSelected ? 'rgba(59,130,246,0.4)' : 'var(--bld-bg-elevated)'}`,
                      borderRadius: 10, padding: 12, cursor: 'pointer',
                      transition: 'all 0.15s', display: 'flex', flexDirection: 'column', gap: 8,
                      boxShadow: isSelected ? '0 0 16px rgba(59,130,246,0.15)' : 'none',
                    }}
                    onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.border = '1px solid rgba(99,102,241,0.3)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; } }}
                    onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.border = '1px solid var(--bld-bg-elevated)'; e.currentTarget.style.background = 'var(--bld-bg-panel)'; } }}
                  >
                    <div style={{ fontSize: 30, textAlign: 'center', lineHeight: 1 }}>{mimeIcon(file.mime)}</div>
                    <div style={{ fontSize: 11, color: 'var(--bld-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 500 }}>
                      {file.key.split('/').pop()}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', textAlign: 'center' }}>{formatBytes(file.size)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* File detail panel */}
        {selected && (
          <div style={{
            width: 280, borderLeft: '1px solid var(--bld-bg-elevated)', flexShrink: 0, overflow: 'auto',
            background: 'var(--bld-bg-elevated)',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Detail header */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--bld-glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--bld-text-2)' }}>File details</span>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 16, padding: 2 }}>✕</button>
            </div>

            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
              <div style={{ fontSize: 36, textAlign: 'center' }}>{mimeIcon(selected.mime)}</div>

              {selected.mime.startsWith('image/') && presignedUrl && (
                <img src={presignedUrl} alt={selected.key} style={{ width: '100%', borderRadius: 8, maxHeight: 140, objectFit: 'cover', border: '1px solid var(--bld-bg-elevated)' }} />
              )}

              {[
                { label: 'File name', value: selected.key.split('/').pop() ?? selected.key },
                { label: 'Type',      value: selected.mime },
                { label: 'Size',      value: formatBytes(selected.size) },
                { label: 'Bucket',    value: selected.bucket },
                { label: 'Added',     value: new Date(selected.createdAt).toLocaleDateString() },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--bld-text-3)', fontFamily: label === 'Type' || label === 'File name' ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value}</div>
                </div>
              ))}

              {presignedUrl && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>URL</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      readOnly
                      value={presignedUrl}
                      style={{ flex: 1, fontSize: 10, background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 5, padding: '5px 8px', color: 'var(--bld-text-disabled)', outline: 'none', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    />
                    <button
                      onClick={() => void navigator.clipboard.writeText(presignedUrl)}
                      style={{ fontSize: 10, padding: '5px 10px', background: 'rgba(59,130,246,0.15)', color: 'var(--bld-info)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 5, cursor: 'pointer', fontWeight: 600 }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              <div style={{ flex: 1 }} />

              <button
                onClick={() => void deleteFile(selected.id)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', fontSize: 11, background: 'rgba(239,68,68,0.08)', color: 'var(--bld-error)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, cursor: 'pointer', fontWeight: 500 }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2 5 4 5 14 5"/><path d="M6 5V3h4v2"/><path d="M5 5l1 8h4l1-8"/>
                </svg>
                Delete file
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: '#7f1d1d', color: '#fca5a5', padding: '9px 18px', borderRadius: 8, fontSize: 12, zIndex: 20, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 4, background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}
