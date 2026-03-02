'use client';

/**
 * State Bar — persistent bottom bar for component state preview switching.
 *
 * Shows: Normal | Hover | Loading | Error | Empty | Disabled | + Custom
 *
 * Active state chip is highlighted. Switching state writes
 * store.activePreviewState so the canvas can simulate the state.
 */

import React, { useState } from 'react';
import { useBuilderStore } from './_store';

// ─── State config ─────────────────────────────────────────────────────────────

export type PreviewState = 'normal' | 'hover' | 'loading' | 'error' | 'empty' | 'disabled' | string;

const BASE_STATES: Array<{ id: PreviewState; label: string; color: string; description: string }> = [
  { id: 'normal',     label: 'Normal',     color: '#9ca3af', description: 'Default state' },
  { id: 'hover',      label: 'Hover',      color: '#818cf8', description: 'Mouse over element' },
  { id: 'loading',    label: 'Loading',    color: '#fbbf24', description: 'Sets _workflow.loading = true' },
  { id: 'error',      label: 'Error',      color: '#f87171', description: 'Sets _workflow.lastError + injects per-field errors (API failure scenario)' },
  { id: 'validation', label: 'Validation', color: '#fb923c', description: 'Injects per-field form validation errors without API error banner' },
  { id: 'empty',      label: 'Empty',      color: '#6ee7b7', description: 'Clears bound array to []' },
  { id: 'disabled',   label: 'Disabled',   color: '#9ca3af', description: 'Disabled interaction states' },
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
          border: `1px solid ${isActive ? color : '#374151'}`,
          borderRadius: '4px 0 0 4px',
          color: isActive ? color : '#9ca3af',
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
        style={{ background: '#1f2937', border: `1px solid #374151`, borderLeft: 'none', borderRadius: '0 4px 4px 0', color: '#6b7280', fontSize: 10, padding: '3px 5px', cursor: 'pointer' }}
      >
        ×
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function StateBar() {
  const { activePreviewStates, togglePreviewState, setPreviewState } = useBuilderStore();
  const [customStates, setCustomStates] = useState<Array<{ id: string; label: string }>>([]);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newCustomName, setNewCustomName] = useState('');

  const addCustom = () => {
    if (!newCustomName.trim()) return;
    const id = `custom-${newCustomName.toLowerCase().replace(/\s+/g, '-')}`;
    setCustomStates(prev => [...prev, { id, label: newCustomName.trim() }]);
    togglePreviewState(id);
    setNewCustomName('');
    setShowAddCustom(false);
  };

  const removeCustom = (id: string) => {
    setCustomStates(prev => prev.filter(s => s.id !== id));
    if (activePreviewStates.includes(id)) setPreviewState('normal');
  };

  const cycleState = () => {
    const all = [...BASE_STATES.map(s => s.id), ...customStates.map(s => s.id)];
    const current = activePreviewStates[0] ?? 'normal';
    const idx = all.indexOf(current);
    const next = all[(idx + 1) % all.length];
    setPreviewState(next);
  };

  return (
    <div
      data-testid="state-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 12px',
        background: 'rgba(9, 14, 26, 0.92)',
        borderTop: '1px solid #1f2937',
        backdropFilter: 'blur(8px)',
        flexShrink: 0,
        overflowX: 'auto',
        flexWrap: 'nowrap',
      }}
    >
      {/* Label */}
      <span style={{ fontSize: 9, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0, marginRight: 4 }}>
        Previewing:
      </span>

      {/* Base states */}
      {BASE_STATES.map(state => {
        const isActive = activePreviewStates.includes(state.id);
        return (
          <React.Fragment key={state.id}>
            <button
              data-testid={`state-chip-${state.id}`}
              onClick={() => togglePreviewState(state.id)}
              title={state.description}
              style={{
                background: isActive ? state.color + '25' : 'transparent',
                border: `1px solid ${isActive ? state.color : '#374151'}`,
                borderRadius: 4,
                color: isActive ? state.color : '#6b7280',
                fontSize: 10,
                padding: '3px 8px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: isActive ? 600 : 400,
                flexShrink: 0,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = '#6b7280'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = '#374151'; }}
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
          onClick={() => togglePreviewState(state.id)}
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
            style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 4, padding: '2px 8px', fontSize: 10, color: '#f3f4f6', outline: 'none', width: 100 }}
          />
          <button onClick={addCustom} style={{ background: '#1d4ed8', border: 'none', borderRadius: 4, color: '#fff', fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}>Add</button>
          <button onClick={() => setShowAddCustom(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 10 }}>✕</button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddCustom(true)}
          title="Add custom state"
          style={{ background: 'none', border: '1px dashed #374151', borderRadius: 4, color: '#6b7280', fontSize: 10, padding: '3px 8px', cursor: 'pointer', flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = '#6b7280')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = '#374151')}
        >
          + Custom
        </button>
      )}

      {/* Cycle shortcut hint */}
      <span
        title="Press S to cycle states"
        onClick={cycleState}
        style={{ marginLeft: 'auto', fontSize: 9, color: '#4b5563', cursor: 'pointer', flexShrink: 0 }}
        onMouseEnter={e => (e.currentTarget.style.color = '#9ca3af')}
        onMouseLeave={e => (e.currentTarget.style.color = '#4b5563')}
      >
        S to cycle
      </span>
    </div>
  );
}
