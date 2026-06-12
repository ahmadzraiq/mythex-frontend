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
      const { url } = await backendStorage.presignUpload(projectId, { bucket, key, mime: file.type || 'application/octet-stream' });
      await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      // Register in DB
      // The file registration should happen via backend on upload completion
      // For now, reload the list
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {/* Bucket tabs */}
        <div style={{ display: 'flex', background: '#111827', borderRadius: 6, padding: 2, gap: 2 }}>
          {(['private', 'public'] as const).map((b) => (
            <button
              key={b}
              onClick={() => { setBucket(b); setSelected(null); }}
              style={{
                padding: '4px 14px',
                fontSize: 11,
                fontWeight: 600,
                background: bucket === b ? '#1e3a5f' : 'transparent',
                color: bucket === b ? '#60a5fa' : '#6b7280',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {b === 'private' ? '🔒 Private' : '🌐 Public'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{ fontSize: 11, padding: '5px 14px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 600 }}
        >
          {uploading ? '⟳ Uploading…' : '↑ Upload file'}
        </button>
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => void handleFileSelect(e)} />
      </div>

      {/* File list + detail */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* File grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {loading && <div style={{ textAlign: 'center', color: 'var(--bld-text-disabled)', fontSize: 12, paddingTop: 40 }}>Loading…</div>}
          {!loading && files.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--bld-text-disabled)', fontSize: 13, paddingTop: 60 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
              <div>No files in this bucket.</div>
              <div style={{ marginTop: 4, fontSize: 11 }}>Click ↑ Upload to add files.</div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {files.map((file) => (
              <div
                key={file.id}
                onClick={() => void openFile(file)}
                style={{
                  background: selected?.id === file.id ? 'rgba(59,130,246,0.12)' : '#111827',
                  border: `1px solid ${selected?.id === file.id ? '#3b82f6' : '#1e293b'}`,
                  borderRadius: 8,
                  padding: 10,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 28, textAlign: 'center' }}>{mimeIcon(file.mime)}</div>
                <div style={{ fontSize: 10, color: 'var(--bld-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                  {file.key.split('/').pop()}
                </div>
                <div style={{ fontSize: 9, color: 'var(--bld-text-disabled)', textAlign: 'center' }}>{formatBytes(file.size)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* File detail panel */}
        {selected && (
          <div style={{ width: 260, borderLeft: '1px solid #1e293b', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, flexShrink: 0, overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>File details</span>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--bld-text-disabled)', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>

            <div style={{ fontSize: 32, textAlign: 'center' }}>{mimeIcon(selected.mime)}</div>

            {[
              { label: 'Key',    value: selected.key },
              { label: 'Type',   value: selected.mime },
              { label: 'Size',   value: formatBytes(selected.size) },
              { label: 'Bucket', value: selected.bucket },
              { label: 'Added',  value: new Date(selected.createdAt).toLocaleDateString() },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 500, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 11, color: 'var(--bld-text-3)', fontFamily: 'monospace', wordBreak: 'break-all' }}>{value}</div>
              </div>
            ))}

            {presignedUrl && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', fontWeight: 500, marginBottom: 4 }}>URL</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    readOnly
                    value={presignedUrl}
                    style={{ flex: 1, fontSize: 10, background: '#111827', border: '1px solid #374151', borderRadius: 4, padding: '4px 6px', color: 'var(--bld-text-disabled)', outline: 'none', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  />
                  <button
                    onClick={() => void navigator.clipboard.writeText(presignedUrl)}
                    style={{ fontSize: 10, padding: '4px 8px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}

            {selected.mime.startsWith('image/') && presignedUrl && (
              <img src={presignedUrl} alt={selected.key} style={{ width: '100%', borderRadius: 6, maxHeight: 140, objectFit: 'cover' }} />
            )}

            <button
              onClick={() => void deleteFile(selected.id)}
              style={{ padding: '7px 0', fontSize: 11, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid #f8717140', borderRadius: 5, cursor: 'pointer', marginTop: 'auto' }}
            >
              🗑 Delete file
            </button>
          </div>
        )}
      </div>

      {error && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: '#7f1d1d', color: '#fca5a5', padding: '8px 16px', borderRadius: 6, fontSize: 12, zIndex: 20 }}>
          {error}<button onClick={() => setError('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}
