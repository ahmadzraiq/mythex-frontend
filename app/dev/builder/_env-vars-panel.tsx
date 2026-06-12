'use client';

import React, { useState, useEffect, useRef } from 'react';
import { envVariables, type EnvVariable } from '@/lib/platform/api-client';

type EnvMode = 'dev' | 'prod';

interface Props {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

interface ModalState {
  open: boolean;
  editing: EnvVariable | null;
}

export default function EnvVarsPanel({ projectId, open, onClose }: Props) {
  const [mode, setMode]                 = useState<EnvMode>('dev');
  const [vars, setVars]                 = useState<EnvVariable[]>([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modal, setModal]               = useState<ModalState>({ open: false, editing: null });
  const dropdownRef                     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !projectId) return;
    setLoading(true);
    setError(null);
    envVariables.list(projectId)
      .then((r) => setVars(r.envVariables))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [dropdownOpen]);

  if (!open) return null;

  const modeLabel = mode === 'dev' ? 'Editor environment' : 'Production environment';

  return (
    <>
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: 400,
        background: 'var(--bld-bg-panel)', borderRight: '1px solid var(--bld-border)',
        display: 'flex', flexDirection: 'column', zIndex: 320,
        boxShadow: '4px 0 24px rgba(0,0,0,0.35)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--bld-border)', flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--bld-text-1)' }}>
            Environment Variables
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-3)', fontSize: 16, lineHeight: 1 }}
          >×</button>
        </div>

        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          borderBottom: '1px solid var(--bld-border)', flexShrink: 0,
        }}>
          {/* Env dropdown */}
          <div ref={dropdownRef} style={{ position: 'relative', flex: 1 }}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '5px 10px', background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border)',
                borderRadius: 5, cursor: 'pointer', fontSize: 11, color: 'var(--bld-text-1)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: mode === 'dev' ? '#818cf8' : '#f97316',
                }} />
                {modeLabel}
              </span>
              <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
            </button>
            {dropdownOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
                background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border)',
                borderRadius: 5, zIndex: 400, overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              }}>
                {(['dev', 'prod'] as EnvMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setDropdownOpen(false); }}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', background: 'none', border: 'none',
                      cursor: 'pointer', fontSize: 11,
                      color: mode === m ? '#818cf8' : 'var(--bld-text-1)',
                    }}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: m === 'dev' ? '#818cf8' : '#f97316',
                    }} />
                    {m === 'dev' ? 'Editor environment' : 'Production environment'}
                    {mode === m && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Insert button */}
          <button
            onClick={() => setModal({ open: true, editing: null })}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
              background: 'var(--bld-ai-accent)', border: 'none', borderRadius: 5,
              cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap',
            }}
          >
            + Insert
          </button>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr auto',
            padding: '6px 12px', borderBottom: '1px solid var(--bld-border)',
            position: 'sticky', top: 0, background: 'var(--bld-bg-panel)', zIndex: 1,
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--bld-text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Key</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--bld-text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Value</span>
            <span />
          </div>

          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--bld-text-disabled)', fontSize: 12 }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ padding: 12, color: 'var(--bld-error)', fontSize: 11, margin: 8, borderRadius: 5, background: 'rgba(239,68,68,0.1)' }}>
              {error}
            </div>
          )}
          {!loading && vars.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--bld-text-disabled)', fontSize: 12 }}>
              No environment variables found
            </div>
          )}

          {vars.map((v) => (
            <div
              key={v.id}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr auto',
                padding: '8px 12px', borderBottom: '1px solid var(--bld-border)',
                alignItems: 'center', gap: 8,
              }}
            >
              <span style={{
                fontSize: 11, fontFamily: 'monospace', color: 'var(--bld-text-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {v.name}
              </span>
              <span style={{
                fontSize: 11, color: 'var(--bld-text-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {mode === 'dev' ? (v.devValue || <em style={{ opacity: 0.4 }}>empty</em>) : (v.prodValue || <em style={{ opacity: 0.4 }}>empty</em>)}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setModal({ open: true, editing: v })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--bld-text-3)', padding: '2px 4px', borderRadius: 3 }}
                  title="Edit"
                >✎</button>
                <button
                  onClick={() => {
                    if (!confirm(`Delete ${v.name}?`)) return;
                    envVariables.delete(projectId, v.name)
                      .then(() => setVars((prev) => prev.filter((x) => x.id !== v.id)))
                      .catch((e) => setError((e as Error).message));
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--bld-error)', padding: '2px 4px', borderRadius: 3 }}
                  title="Delete"
                >✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 319, background: 'transparent' }}
      />

      {/* Modal */}
      {modal.open && (
        <EnvVarModal
          editing={modal.editing}
          onClose={() => setModal({ open: false, editing: null })}
          onSave={async (name, devValue, prodValue) => {
            const upperName = name.toUpperCase();
            const res = await envVariables.upsert(projectId, upperName, { devValue, prodValue });
            setVars((prev) => {
              const existing = prev.findIndex((v) => v.id === res.envVariable.id);
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = res.envVariable;
                return next;
              }
              return [...prev, res.envVariable].sort((a, b) => a.name.localeCompare(b.name));
            });
            setModal({ open: false, editing: null });
          }}
        />
      )}
    </>
  );
}

function EnvVarModal({
  editing,
  onClose,
  onSave,
}: {
  editing: EnvVariable | null;
  onClose: () => void;
  onSave: (name: string, devValue: string, prodValue: string) => Promise<void>;
}) {
  const [name, setName]         = useState(editing?.name ?? '');
  const [devValue, setDevValue] = useState(editing?.devValue ?? '');
  const [prodValue, setProd]    = useState(editing?.prodValue ?? '');
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  const handleSave = async () => {
    const upperName = name.trim().toUpperCase();
    if (!upperName) { setErr('Name is required'); return; }
    if (!/^[A-Z0-9_]+$/.test(upperName)) { setErr('Name must be uppercase letters, numbers, and underscores only'); return; }
    setSaving(true);
    try {
      await onSave(upperName, devValue, prodValue);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
    }}>
      <div style={{
        background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border)',
        borderRadius: 10, width: 460, padding: 24, boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--bld-text-1)' }}>
            {editing ? 'Edit Environment Variable' : 'Add Environment Variable'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--bld-text-3)', lineHeight: 1 }}>×</button>
        </div>

        {/* Name */}
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--bld-text-2)', display: 'block', marginBottom: 5 }}>
            Name <span style={{ color: 'var(--bld-error)' }}>*</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase())}
            disabled={!!editing}
            placeholder="VARIABLE_NAME"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              background: editing ? 'var(--bld-bg-input)' : 'var(--bld-bg-elevated)',
              border: '1px solid var(--bld-border)', borderRadius: 5, fontSize: 12,
              color: 'var(--bld-text-1)', fontFamily: 'monospace', outline: 'none',
            }}
          />
        </label>

        {/* Editor value */}
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--bld-text-2)', display: 'block', marginBottom: 5 }}>
            Editor <span style={{ color: 'var(--bld-error)' }}>*</span>
          </span>
          <input
            value={devValue}
            onChange={(e) => setDevValue(e.target.value)}
            placeholder="Editor Value"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border)',
              borderRadius: 5, fontSize: 12, color: 'var(--bld-text-1)', outline: 'none',
            }}
          />
        </label>

        {/* Production value */}
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--bld-text-2)', display: 'block', marginBottom: 5 }}>
            Production
          </span>
          <input
            value={prodValue}
            onChange={(e) => setProd(e.target.value)}
            placeholder="Production Value"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border)',
              borderRadius: 5, fontSize: 12, color: 'var(--bld-text-1)', outline: 'none',
            }}
          />
        </label>

        {err && (
          <div style={{ marginBottom: 14, fontSize: 11, color: 'var(--bld-error)', background: 'rgba(239,68,68,0.1)', padding: '6px 10px', borderRadius: 4 }}>
            {err}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 20px', background: '#10b981', border: 'none', borderRadius: 6,
              cursor: saving ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700,
              color: '#fff', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  );
}
