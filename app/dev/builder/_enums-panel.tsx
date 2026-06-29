'use client';
/**
 * Enums panel — author shared enum types used by model fields (type: "enum").
 *
 * Enums map to a CHECK constraint on the physical column via the migration
 * engine. They are referenced by name from a field's `enum` property.
 */
import React, { useState, useEffect } from 'react';
import { backendEnums, type ModelEnumJson } from '@/lib/platform/api-client';
import { useBackendConfig, patchCachedEnums } from '@/lib/builder/use-backend-config';
import { EmptyEnums } from './_icons';

const BTN: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 12px', fontSize: 12, fontWeight: 500,
  background: 'transparent', color: 'var(--bld-text-3)',
  border: '1px solid var(--bld-border-subtle)', borderRadius: 6,
  cursor: 'pointer', whiteSpace: 'nowrap',
};
const BTN_PRIMARY: React.CSSProperties = {
  ...BTN, background: 'var(--bld-accent-hover)', color: '#fff', border: '1px solid #4f46e5', fontWeight: 600,
};
const INPUT: React.CSSProperties = {
  background: 'var(--bld-bg-elevated)', border: '1px solid var(--bld-border-subtle)', borderRadius: 6,
  padding: '7px 10px', fontSize: 13, color: 'var(--bld-text-2)', outline: 'none', width: '100%', boxSizing: 'border-box',
};

interface Props { projectId: string }

export function EnumsPanel({ projectId }: Props) {
  const { enums, loading } = useBackendConfig(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftValues, setDraftValues] = useState<string[]>([]);
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newEnumName, setNewEnumName] = useState('');

  // Auto-select first enum when data loads.
  useEffect(() => {
    if (!selected && enums.length) selectEnum(enums[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enums]);

  const selectEnum = (e: ModelEnumJson) => {
    setSelected(e.name);
    setDraftName(e.name);
    setDraftValues([...e.values]);
    setError('');
  };

  const selectedEnum = enums.find((e) => e.name === selected) ?? null;

  const save = async () => {
    if (!draftName.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const body: ModelEnumJson = { name: draftName.trim(), values: draftValues, folder: selectedEnum?.folder };
      const res = await backendEnums.upsert(projectId, body);
      patchCachedEnums(projectId, (prev) => {
        const exists = prev.some((e) => e.name === res.enum.name);
        return exists ? prev.map((e) => e.name === res.enum.name ? res.enum : e) : [...prev, res.enum];
      });
      setSelected(body.name);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete enum "${name}"? Fields referencing it will fail validation until updated.`)) return;
    try {
      await backendEnums.delete(projectId, name);
      patchCachedEnums(projectId, (prev) => prev.filter((e) => e.name !== name));
      if (selected === name) { setSelected(null); setDraftName(''); setDraftValues([]); }
    } catch (e) { setError((e as Error).message); }
  };

  const createEnum = async () => {
    const name = newEnumName.trim();
    if (!name) return;
    try {
      const created = await backendEnums.upsert(projectId, { name, values: [] });
      patchCachedEnums(projectId, (prev) => [...prev, created.enum]);
      setNewEnumName('');
      setCreating(false);
    } catch (e) { setError((e as Error).message); }
  };

  const addValue = () => {
    const v = newValue.trim();
    if (!v || draftValues.includes(v)) { setNewValue(''); return; }
    setDraftValues((p) => [...p, v]);
    setNewValue('');
  };

  return (
    <div style={{
      flex: 1, display: 'flex', height: '100%', overflow: 'hidden',
    }}>
      {/* ── Left sidebar: enum list ────────────────────────────────────────── */}
      <div style={{
        width: 240, borderRight: '1px solid var(--bld-bg-elevated)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        backgroundColor: 'var(--bld-bg-panel)',
        backgroundImage: 'radial-gradient(ellipse 160% 40% at 50% 100%, rgba(99,102,241,0.07) 0%, transparent 60%)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 14px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--bld-glass-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.8" strokeLinecap="round">
              <line x1="3" y1="5" x2="13" y2="5"/><line x1="3" y1="8" x2="10" y2="8"/><line x1="3" y1="11" x2="8" y2="11"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--bld-text-2)', letterSpacing: 0.3 }}>Enums</span>
            {enums.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', background: 'var(--bld-bg-elevated)', borderRadius: 10, padding: '1px 7px' }}>
                {enums.length}
              </span>
            )}
          </div>
          <button onClick={() => setCreating((v) => !v)} style={{ ...BTN_PRIMARY, padding: '4px 10px', fontSize: 11, gap: 4 }}>
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
            Add
          </button>
        </div>

        {/* New enum form */}
        {creating && (
          <div style={{ padding: 12, borderBottom: '1px solid var(--bld-bg-elevated)', background: 'rgba(79,70,229,0.06)' }}>
            <input autoFocus value={newEnumName} onChange={(e) => setNewEnumName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void createEnum(); if (e.key === 'Escape') setCreating(false); }}
              placeholder="EnumName" style={{ ...INPUT, fontSize: 12, padding: '6px 10px' }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => void createEnum()} disabled={!newEnumName.trim()}
                style={{ ...BTN_PRIMARY, flex: 1, justifyContent: 'center', fontSize: 11 }}>Create</button>
              <button onClick={() => setCreating(false)} style={{ ...BTN, padding: '5px 10px', fontSize: 11 }}>✕</button>
            </div>
          </div>
        )}

        {/* Enum list */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--bld-text-disabled)' }}>Loading…</div>}
          {!loading && enums.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <EmptyEnums />
              <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>
                No enums yet.<br />Click <strong style={{ color: 'var(--bld-text-3)' }}>+ Add</strong> to create one.
              </div>
            </div>
          )}
          {enums.map((e) => {
            const active = e.name === selected;
            return (
              <div key={e.name} onClick={() => selectEnum(e)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer',
                background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                borderLeft: `2px solid ${active ? 'var(--bld-accent)' : 'transparent'}`,
                transition: 'background 0.12s',
              }}
                onMouseEnter={el => { if (!active) el.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={el => { if (!active) el.currentTarget.style.background = 'transparent'; }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={active ? 'var(--bld-accent)' : 'var(--bld-text-disabled)'} strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <line x1="3" y1="5" x2="13" y2="5"/><line x1="3" y1="9" x2="10" y2="9"/><line x1="3" y1="13" x2="7" y2="13"/>
                </svg>
                <span style={{ flex: 1, fontSize: 12, color: active ? '#e2e8f0' : 'var(--bld-text-3)', fontWeight: active ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.name}
                </span>
                <span style={{
                  fontSize: 10, color: active ? 'var(--bld-accent)' : 'var(--bld-text-disabled)',
                  background: active ? 'rgba(99,102,241,0.15)' : 'var(--bld-bg-elevated)',
                  borderRadius: 8, padding: '1px 6px', flexShrink: 0,
                }}>
                  {e.values.length}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Editor ────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bld-bg-canvas)', backgroundImage: 'radial-gradient(ellipse 65% 50% at 80% 5%, rgba(99,102,241,0.08) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 10% 95%, rgba(124,58,237,0.07) 0%, transparent 55%)' }}>
        {!selectedEnum && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
              boxShadow: '0 0 32px rgba(99,102,241,0.12)',
            }}>
              <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="var(--bld-accent)" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="5" x2="13" y2="5"/><line x1="3" y1="9" x2="10" y2="9"/><line x1="3" y1="13" x2="7" y2="13"/>
              </svg>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--bld-text-2)', marginBottom: 6 }}>Select an enum</div>
              <div style={{ fontSize: 12, color: 'var(--bld-text-disabled)', maxWidth: 260, lineHeight: 1.6 }}>
                Enums define a set of allowed string values for model fields.
              </div>
            </div>
          </div>
        )}
        {selectedEnum && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {/* Glass header */}
            <div style={{
              padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'var(--bld-glass-bg)', backdropFilter: 'blur(12px)',
              borderBottom: '1px solid var(--bld-glass-border)', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--bld-text-1)' }}>{selectedEnum.name}</span>
                <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', background: 'var(--bld-bg-elevated)', borderRadius: 8, padding: '2px 8px' }}>
                  {selectedEnum.values.length} values
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => void save()} disabled={saving}
                  style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1, gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 8 5 12 15 3"/></svg>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => void remove(selectedEnum.name)}
                  style={{ ...BTN, color: 'var(--bld-error)', borderColor: 'rgba(239,68,68,0.25)', padding: '5px 9px' }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2 5 4 5 14 5"/><path d="M6 5V3h4v2"/><path d="M5 5l1 8h4l1-8"/>
                  </svg>
                </button>
              </div>
            </div>

            <div style={{ padding: 24, maxWidth: 560 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', marginBottom: 8 }}>Name</label>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} style={INPUT} />

              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-3)', display: 'block', margin: '22px 0 10px' }}>Values</label>

              {/* Value chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: draftValues.length ? 12 : 0 }}>
                {draftValues.map((v, i) => (
                  <div key={`${v}-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)',
                    borderRadius: 20, padding: '4px 6px 4px 12px',
                  }}>
                    <input value={v} onChange={(e) => setDraftValues((p) => p.map((x, j) => j === i ? e.target.value : x))}
                      style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 12, color: '#a5b4fc', fontWeight: 500, width: Math.max(v.length * 8, 40) }} />
                    <button onClick={() => setDraftValues((p) => p.filter((_, j) => j !== i))}
                      style={{ background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bld-error)', padding: 0 }}>
                      <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>
                    </button>
                  </div>
                ))}
              </div>

              {/* Add value */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input value={newValue} onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addValue(); }}
                  placeholder="Add value…" style={{ ...INPUT, flex: 1 }} />
                <button onClick={addValue} style={{ ...BTN_PRIMARY, padding: '7px 14px' }}>+ Add</button>
              </div>

              {error && (
                <div style={{ marginTop: 14, fontSize: 12, color: 'var(--bld-error)', background: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: '10px 14px', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {error}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
