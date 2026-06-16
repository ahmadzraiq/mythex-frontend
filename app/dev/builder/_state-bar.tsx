'use client';

/**
 * State Bar — persistent bottom bar for component state preview switching.
 *
 * Shows: Normal | Hover | Loading | Error | Empty | Disabled | + Custom
 *
 * Active state chip is highlighted. Switching state writes
 * store.activePreviewState so the canvas can simulate the state.
 */

import React, { useState, startTransition } from 'react';
import { useBuilderStore } from './_store';

// ─── State config ─────────────────────────────────────────────────────────────

export type PreviewState = 'normal' | 'loading' | 'validation' | 'empty' | 'disabled' | string;

const BASE_STATES: Array<{ id: PreviewState; label: string; color: string; description: string }> = [
  { id: 'normal',     label: 'Normal',     color: 'var(--bld-text-3)', description: 'Default state' },
  { id: 'loading',    label: 'Loading',    color: 'var(--bld-warning)', description: 'Sets _workflow.loading = true; force-shows nodes tagged _stateTag: "loading"' },
  { id: 'validation', label: 'Validation', color: '#fb923c', description: 'Injects per-field form validation errors without API error banner' },
  { id: 'empty',      label: 'Empty',      color: '#6ee7b7', description: 'Clears bound arrays to []; force-shows nodes tagged _stateTag: "empty"' },
  { id: 'disabled',   label: 'Disabled',   color: 'var(--bld-text-3)', description: 'Force-shows disabled overlay on nodes that have props.disabled configured' },
];

// ─── Custom state editor ──────────────────────────────────────────────────────

function CustomStateChip({ id, label, isActive, color, onClick, onRemove }: {
  id: string;
  label: string;
  isActive: boolean;
  color: string;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <button
        onClick={onClick}
        title={`Preview "${label}" state`}
        style={{
          background: isActive ? color + '30' : 'transparent',
          border: `1px solid ${isActive ? color : 'var(--bld-border)'}`,
          borderRadius: '4px 0 0 4px',
          color: isActive ? color : 'var(--bld-text-3)',
          fontSize: 10,
          padding: '3px 8px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontWeight: isActive ? 600 : 400,
        }}
      >
        {label}
      </button>
      <button
        onClick={onRemove}
        style={{ background: 'var(--bld-bg-elevated)', border: `1px solid var(--bld-border)`, borderLeft: 'none', borderRadius: '0 4px 4px 0', color: 'var(--bld-text-disabled)', fontSize: 10, padding: '3px 5px', cursor: 'pointer' }}
      >
        ×
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function StateBar() {
  const { activePreviewStates, setPreviewState } = useBuilderStore();
  const [customStates, setCustomStates] = useState<Array<{ id: string; label: string }>>([]);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newCustomName, setNewCustomName] = useState('');

  // Single-select: clicking the active chip goes back to Normal.
  // Wrapped in startTransition so the heavy canvas re-render is low-priority
  // and won't block ongoing pan/mouse interactions.
  const selectState = (id: PreviewState) => {
    startTransition(() => {
      setPreviewState(activePreviewStates.includes(id) ? 'normal' : id);
    });
  };

  const addCustom = () => {
    if (!newCustomName.trim()) return;
    const id = `custom-${newCustomName.toLowerCase().replace(/\s+/g, '-')}`;
    setCustomStates(prev => [...prev, { id, label: newCustomName.trim() }]);
    startTransition(() => setPreviewState(id));
    setNewCustomName('');
    setShowAddCustom(false);
  };

  const removeCustom = (id: string) => {
    setCustomStates(prev => prev.filter(s => s.id !== id));
    if (activePreviewStates.includes(id)) startTransition(() => setPreviewState('normal'));
  };

  const cycleState = () => {
    const all = [...BASE_STATES.map(s => s.id), ...customStates.map(s => s.id)];
    const current = activePreviewStates[0] ?? 'normal';
    const idx = all.indexOf(current);
    const next = all[(idx + 1) % all.length];
    startTransition(() => setPreviewState(next));
  };

  return (
    <div
      data-testid="state-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 12px',
        background: 'var(--bld-bg-panel)',
        borderTop: '1px solid var(--bld-border-subtle)',
        backdropFilter: 'blur(8px)',
        flexShrink: 0,
        overflowX: 'auto',
        flexWrap: 'nowrap',
      }}
    >
      {/* Label */}
      <span style={{ fontSize: 9, color: 'var(--bld-text-disabled)', textTransform: 'none', flexShrink: 0, marginRight: 4 }}>
        Previewing:
      </span>

      {/* Base states */}
      {BASE_STATES.map(state => {
        const isActive = activePreviewStates.includes(state.id);
        return (
          <React.Fragment key={state.id}>
            <button
              data-testid={`state-chip-${state.id}`}
              onClick={() => selectState(state.id)}
              title={state.description}
              style={{
                background: isActive ? state.color + '25' : 'transparent',
                border: `1px solid ${isActive ? state.color : 'var(--bld-border)'}`,
                borderRadius: 4,
                color: isActive ? state.color : 'var(--bld-text-disabled)',
                fontSize: 10,
                padding: '3px 8px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: isActive ? 600 : 400,
                flexShrink: 0,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--bld-text-disabled)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--bld-border)'; }}
            >
              {isActive && '● '}{state.label}
            </button>
          </React.Fragment>
        );
      })}

      {/* Custom states */}
      {customStates.map(state => (
        <CustomStateChip
          key={state.id}
          id={state.id}
          label={state.label}
          isActive={activePreviewStates.includes(state.id)}
          color="#c084fc"
          onClick={() => selectState(state.id)}
          onRemove={() => removeCustom(state.id)}
        />
      ))}

      {/* Add custom */}
      {showAddCustom ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            value={newCustomName}
            onChange={e => setNewCustomName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCustom(); if (e.key === 'Escape') setShowAddCustom(false); }}
            placeholder="State name…"
            autoFocus
            style={{ background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border)', borderRadius: 4, padding: '2px 8px', fontSize: 10, color: 'var(--bld-text-2)', outline: 'none', width: 100 }}
          />
          <button onClick={addCustom} style={{ background: 'var(--bld-accent)', border: 'none', borderRadius: 4, color: '#fff', fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}>Add</button>
          <button onClick={() => setShowAddCustom(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', fontSize: 10 }}>✕</button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddCustom(true)}
          title="Add custom state"
          style={{ background: 'none', border: '1px dashed var(--bld-border)', borderRadius: 4, color: 'var(--bld-text-disabled)', fontSize: 10, padding: '3px 8px', cursor: 'pointer', flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--bld-text-disabled)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--bld-border)')}
        >
          + Custom
        </button>
      )}

      {/* Cycle shortcut hint */}
      <span
        title="Press S to cycle states"
        onClick={cycleState}
        style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--bld-text-disabled)', cursor: 'pointer', flexShrink: 0 }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--bld-text-3)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--bld-text-disabled)')}
      >
        S to cycle
      </span>
    </div>
  );
}
