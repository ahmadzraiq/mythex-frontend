'use client';
/**
 * Native Auth Admin — project end-user management panel.
 * Lists users, allows search, edit, disable, reset password.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { backendAuth, type ProjectUser } from '@/lib/platform/api-client';

interface Props {
  projectId: string;
}

export function NativeAuthAdmin({ projectId }: Props) {
  const [users, setUsers]     = useState<ProjectUser[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState('');
  const [offset, setOffset]   = useState(0);
  const [selected, setSelected] = useState<ProjectUser | null>(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const limit = 20;
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadUsers = useCallback(async (query: string, off: number) => {
    setLoading(true);
    try {
      const res = await backendAuth.listUsers(projectId, {
        q:      query || undefined,
        limit:  String(limit),
        offset: String(off),
      });
      setUsers(res.users);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadUsers(q, offset); }, [loadUsers, q, offset]);

  const handleSearch = (value: string) => {
    setQ(value);
    setOffset(0);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => void loadUsers(value, 0), 300);
  };

  const updateUser = async (userId: string, patch: { name?: string; is_disabled?: boolean }) => {
    setSaving(true);
    try {
      const res = await backendAuth.updateUser(projectId, userId, patch);
      setUsers((prev) => prev.map((u) => u.id === userId ? res.user : u));
      if (selected?.id === userId) setSelected(res.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (userId: string) => {
    const newPwd = prompt('Enter new password (min 8 chars):');
    if (!newPwd || newPwd.length < 8) return;
    setSaving(true);
    try {
      await backendAuth.resetPassword(projectId, userId, newPwd);
      alert('Password reset successfully.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ── Users list ────────────────────────────────────────────────── */}
      <div style={{ width: 320, borderRight: '1px solid var(--bld-bg-elevated)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Header */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bld-bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>Users</span>
          <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>{total} total</span>
        </div>

        {/* Search */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--bld-bg-elevated)' }}>
          <input
            value={q}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search email or name…"
            style={{
              background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4,
              padding: '5px 8px', fontSize: 12, color: 'var(--bld-text-2)', outline: 'none',
              width: '100%', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* User rows */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && <div style={{ padding: 16, textAlign: 'center', color: 'var(--bld-text-disabled)', fontSize: 12 }}>Loading…</div>}
          {!loading && users.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--bld-text-disabled)', fontSize: 12 }}>
              No users found.
            </div>
          )}
          {users.map((user) => (
            <div
              key={user.id}
              onClick={() => setSelected(user)}
              style={{
                padding: '8px 14px',
                cursor: 'pointer',
                borderBottom: '1px solid rgba(30,41,59,0.4)',
                background: selected?.id === user.id ? 'rgba(59,130,246,0.08)' : 'transparent',
                borderLeft: `2px solid ${selected?.id === user.id ? '#3b82f6' : 'transparent'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: user.is_disabled ? '#374151' : 'linear-gradient(135deg,#3b82f6,#6366f1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#fff',
                }}>
                  {(user.name ?? user.email).charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, color: user.is_disabled ? 'var(--bld-text-disabled)' : '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.name ?? user.email}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--bld-text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
                </div>
                {user.is_disabled && <span style={{ fontSize: 9, color: 'var(--bld-error)', background: '#7f1d1d22', padding: '1px 4px', borderRadius: 3 }}>Disabled</span>}
                {user.email_verified && <span style={{ fontSize: 9, color: 'var(--bld-success)' }}>✓</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {total > limit && (
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--bld-bg-elevated)', display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              style={{ fontSize: 11, padding: '3px 8px', background: 'transparent', color: offset === 0 ? '#374151' : 'var(--bld-info)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, cursor: offset === 0 ? 'default' : 'pointer' }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)', alignSelf: 'center' }}>{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
            <button
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
              style={{ fontSize: 11, padding: '3px 8px', background: 'transparent', color: offset + limit >= total ? '#374151' : 'var(--bld-info)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, cursor: offset + limit >= total ? 'default' : 'pointer' }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── User detail panel ─────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--bld-text-disabled)', fontSize: 13 }}>
            Select a user to view details
          </div>
        ) : (
          <UserDetail
            user={selected}
            onUpdate={(patch) => void updateUser(selected.id, patch)}
            onResetPassword={() => void resetPassword(selected.id)}
            saving={saving}
          />
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

function UserDetail({ user, onUpdate, onResetPassword, saving }: {
  user: ProjectUser;
  onUpdate: (patch: { name?: string; is_disabled?: boolean }) => void;
  onResetPassword: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(user.name ?? '');

  useEffect(() => { setName(user.name ?? ''); }, [user.id, user.name]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: user.is_disabled ? '#374151' : 'linear-gradient(135deg,#3b82f6,#6366f1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, color: '#fff',
        }}>
          {(user.name ?? user.email).charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--bld-text-2)' }}>{user.name ?? '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)' }}>{user.email}</div>
        </div>
      </div>

      {/* Status badges */}
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: user.email_verified ? '#14532d' : 'var(--bld-bg-elevated)', color: user.email_verified ? '#4ade80' : 'var(--bld-text-disabled)' }}>
          {user.email_verified ? '✓ Email verified' : '⚠ Not verified'}
        </span>
        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: user.is_disabled ? '#7f1d1d' : '#14532d', color: user.is_disabled ? '#fca5a5' : '#4ade80' }}>
          {user.is_disabled ? '⛔ Disabled' : '✓ Active'}
        </span>
      </div>

      {/* Name edit */}
      <div>
        <label style={{ fontSize: 11, color: 'var(--bld-text-3)', fontWeight: 500, display: 'block', marginBottom: 4 }}>Display name</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border-subtle)', borderRadius: 4, padding: '5px 8px', fontSize: 12, color: 'var(--bld-text-2)', outline: 'none' }}
          />
          <button
            onClick={() => onUpdate({ name })}
            disabled={saving || name === (user.name ?? '')}
            style={{ padding: '5px 12px', fontSize: 11, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 11, color: 'var(--bld-text-3)', fontWeight: 500 }}>Actions</label>
        <button
          onClick={() => onUpdate({ is_disabled: !user.is_disabled })}
          disabled={saving}
          style={{ padding: '7px 14px', fontSize: 12, background: user.is_disabled ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: user.is_disabled ? '#4ade80' : 'var(--bld-error)', border: `1px solid ${user.is_disabled ? '#4ade8040' : '#f8717140'}`, borderRadius: 5, cursor: 'pointer', textAlign: 'left' }}
        >
          {user.is_disabled ? '✓ Enable account' : '⛔ Disable account'}
        </button>
        <button
          onClick={onResetPassword}
          disabled={saving}
          style={{ padding: '7px 14px', fontSize: 12, background: 'transparent', color: 'var(--bld-text-3)', border: '1px solid var(--bld-border-subtle)', borderRadius: 5, cursor: 'pointer', textAlign: 'left' }}
        >
          🔑 Reset password
        </button>
      </div>

      {/* Meta */}
      <div>
        <label style={{ fontSize: 11, color: 'var(--bld-text-3)', fontWeight: 500, display: 'block', marginBottom: 4 }}>User ID</label>
        <code style={{ fontSize: 11, color: 'var(--bld-text-disabled)', fontFamily: 'monospace' }}>{user.id}</code>
      </div>
      <div>
        <label style={{ fontSize: 11, color: 'var(--bld-text-3)', fontWeight: 500, display: 'block', marginBottom: 4 }}>Created</label>
        <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>{new Date(user.created_at).toLocaleString()}</span>
      </div>
    </div>
  );
}
