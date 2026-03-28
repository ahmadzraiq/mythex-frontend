'use client';

/**
 * Popups Tab — left panel "Popups" tab.
 *
 * WeWeb-style popup management:
 *   - "Opened instances" section: live list of currently open popup instances
 *   - "Project popup models" section: list of all popup models with Edit/Open/⋮ actions
 *   - "+ New" button: opens type picker to create a new popup model
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { usePopupStore } from '@/lib/sdui/popup-store';
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import {
  getPopupList,
  createPopup as createPopupData,
  updatePopup as updatePopupData,
  deletePopup as deletePopupData,
  subscribePopups,
} from '@/lib/builder/popup-data';

// ─── ID population utility ────────────────────────────────────────────────────

/**
 * Recursively walks a node tree and assigns crypto.randomUUID() to any node
 * that doesn't already have an `id`. Returns the updated tree and a flag
 * indicating whether any IDs were added (so the caller can decide to persist).
 */
function ensureNodeIds(node: Record<string, unknown>): { node: Record<string, unknown>; changed: boolean } {
  let changed = false;
  let result = node;

  if (!node.id) {
    result = { ...node, id: crypto.randomUUID() };
    changed = true;
  }

  const children = (result.children ?? []) as Record<string, unknown>[];
  if (children.length > 0) {
    const newChildren: Record<string, unknown>[] = [];
    for (const child of children) {
      const r = ensureNodeIds(child);
      newChildren.push(r.node);
      if (r.changed) changed = true;
    }
    if (changed) result = { ...result, children: newChildren };
  }

  return { node: result, changed };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PopupProperty {
  id: string;
  name: string;
  type: string;
  defaultValue?: unknown;
}

export interface PopupModel {
  id: string;
  name: string;
  type: 'Blank' | 'Modal' | 'Sheet' | 'Alert' | 'StackedAlert';
  allowStacking: boolean;
  properties: PopupProperty[];
  content: Record<string, unknown>;
}

// ─── Starter content templates ────────────────────────────────────────────────
// Each template uses backdrop-as-root structure:
//   content = Backdrop Box (full-screen, bg color, centering, click-to-close action)
//     └── Card Box (popup content, stopPropagation so clicks don't close)
//
// This makes the backdrop a proper selectable SDUI container — users can resize
// it, change its background color, change centering, etc., just like any Box.

const STARTER_CONTENT: Record<string, Record<string, unknown>> = {
  Blank: {
    type: 'Box',
    name: 'Backdrop',
    actions: [{ action: 'closeAllPopups' }],
    props: { className: 'w-full h-screen flex items-center justify-center bg-black/50' },
    children: [
      {
        type: 'Box',
        name: 'Content',
        actions: [{ stopPropagation: true }],
        props: { className: 'bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-80' },
        children: [],
      },
    ],
  },

  Modal: {
    type: 'Box',
    name: 'Backdrop',
    animation: { enter: { type: 'fade', duration: 150 }, exit: { type: 'fade', duration: 200 } },
    actions: [{ action: 'closeAllPopups' }],
    props: { className: 'w-full h-screen flex items-center justify-center p-4 bg-black/55' },
    children: [{
      type: 'Box',
      name: 'Modal',
      animation: { enter: { type: 'zoomIn', duration: 220 }, exit: { type: 'zoomOut', duration: 200 } },
      actions: [{ stopPropagation: true }],
      props: { className: 'w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl overflow-hidden flex flex-col' },
      children: [
        {
          type: 'Box',
          props: { className: 'px-6 pt-6 pb-2' },
          children: [{ type: 'Text', props: { className: 'text-lg font-semibold text-gray-900 dark:text-white' }, text: 'Modal title' }],
        },
        {
          type: 'Box',
          props: { className: 'px-6 py-4 flex-1' },
          children: [{ type: 'Text', props: { className: 'text-sm text-gray-500' }, text: 'Content goes here.' }],
        },
        {
          type: 'Box',
          props: { className: 'px-6 py-4 flex flex-row gap-3 justify-end border-t border-gray-100 dark:border-gray-800' },
          children: [
            { type: 'Button', actions: [{ action: 'closeAllPopups' }], props: { action: 'outline' }, children: [{ type: 'ButtonText', text: 'Cancel' }] },
            { type: 'Button', actions: [{ action: 'closeAllPopups' }], props: { action: 'primary' }, children: [{ type: 'ButtonText', text: 'Confirm' }] },
          ],
        },
      ],
    }],
  },

  Sheet: {
    type: 'Box',
    name: 'Backdrop',
    animation: { enter: { type: 'fade', duration: 150 }, exit: { type: 'fade', duration: 220 } },
    actions: [{ action: 'closeAllPopups' }],
    // flex-row is required: without it NativeWind defaults to flex-col, making
    // justify-end push the panel to the bottom instead of the right.
    // h-screen (100vh) instead of h-full: percentage heights only resolve when every
    // ancestor has an explicit pixel height — h-screen is always explicit.
    props: { className: 'w-full h-screen flex flex-row justify-end bg-black/40' },
    children: [{
      type: 'Box',
      name: 'Sheet',
      animation: { enter: { type: 'slideInRight', duration: 260 }, exit: { type: 'slideOutRight', duration: 220 } },
      actions: [{ stopPropagation: true }],
      props: { className: 'w-80 h-screen bg-white dark:bg-gray-900 shadow-2xl flex flex-col' },
      children: [
        {
          type: 'Box',
          props: { className: 'px-4 py-4 flex flex-row items-center justify-between border-b border-gray-100 dark:border-gray-800' },
          children: [
            { type: 'Text', props: { className: 'text-base font-semibold text-gray-900 dark:text-white' }, text: 'Sheet title' },
            { type: 'Button', actions: [{ action: 'closeAllPopups' }], props: { action: 'link', size: 'sm' }, children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 18, color: '#6b7280' } }] },
          ],
        },
        { type: 'Box', props: { className: 'flex-1 px-4 py-6' }, children: [] },
      ],
    }],
  },

  // Alert and StackedAlert are toast-style. The backdrop wrapper is kept so
  // builder edit mode (which appends model.content to pageNodes) shows the card
  // at the correct bottom-right position inside the canvas.
  // At runtime, PopupRenderer skips the backdrop and renders only the card
  // (model.content.children[0]) inside the shared bottom-right stack container.
  Alert: {
    type: 'Box',
    name: 'Backdrop',
    // Full-screen flex shell. Change items-*/justify-* to move the stack to a
    // different corner (e.g. items-start justify-start = top-left).
    // Change p-* to control the edge padding.
    props: { className: 'w-full h-screen flex flex-col items-end justify-end p-4 pointer-events-none' },
    children: [{
      type: 'Box',
      name: 'StackContainer',
      // Normal-flow child — content-sized because parent has items-end.
      // Change gap-* to space cards. Change flex-col-reverse to reverse stack order.
      props: { className: 'flex flex-col gap-2 pointer-events-none' },
      children: [{
        type: 'Box',
        name: 'Alert',
        animation: { enter: { type: 'slideInRight', duration: 200 }, exit: { type: 'slideOutRight', duration: 180 } },
        props: { className: 'pointer-events-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg px-4 py-3 flex flex-row items-start gap-3 min-w-72 max-w-sm border border-gray-100 dark:border-gray-700' },
        children: [
          {
            type: 'Box',
            props: { className: 'w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 items-center justify-center flex shrink-0 mt-0.5' },
            children: [{ type: 'Icon', props: { icon: 'lucide:alert-triangle', size: 16, color: '#f59e0b' } }],
          },
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-col gap-0.5' },
            children: [
              { type: 'Text', props: { className: 'text-sm font-semibold text-gray-900 dark:text-white' }, text: 'Alert title' },
              { type: 'Text', props: { className: 'text-xs text-gray-500 dark:text-gray-400 leading-relaxed' }, text: 'Alert message goes here.' },
            ],
          },
          {
            type: 'Box',
            actions: [{ action: 'closePopup' }],
            props: { className: 'shrink-0 mt-0.5 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700' },
            children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 14, color: '#9ca3af' } }],
          },
        ],
      }],
    }],
  },

  StackedAlert: {
    type: 'Box',
    name: 'Backdrop',
    props: { className: 'w-full h-screen flex flex-col items-end justify-end p-4 pointer-events-none' },
    children: [{
      type: 'Box',
      name: 'StackContainer',
      props: { className: 'flex flex-col gap-2 pointer-events-none' },
      children: [{
        type: 'Box',
        name: 'Toast',
        animation: { enter: { type: 'slideInRight', duration: 200 }, exit: { type: 'slideOutRight', duration: 180 } },
        props: { className: 'pointer-events-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg px-4 py-3 flex flex-row items-start gap-3 min-w-72 max-w-sm border border-gray-100 dark:border-gray-700' },
        children: [
          {
            type: 'Box',
            props: { className: 'w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 items-center justify-center flex shrink-0 mt-0.5' },
            children: [{ type: 'Icon', props: { icon: 'lucide:bell', size: 16, color: '#3b82f6' } }],
          },
          {
            type: 'Box',
            props: { className: 'flex-1 flex flex-col gap-0.5' },
            children: [
              { type: 'Text', props: { className: 'text-sm font-semibold text-gray-900 dark:text-white' }, text: 'Notification title' },
              { type: 'Text', props: { className: 'text-xs text-gray-500 dark:text-gray-400' }, text: 'Notification message' },
            ],
          },
          {
            type: 'Box',
            actions: [{ action: 'closePopup' }],
            props: { className: 'shrink-0 mt-0.5 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700' },
            children: [{ type: 'Icon', props: { icon: 'lucide:x', size: 14, color: '#9ca3af' } }],
          },
        ],
      }],
    }],
  },
};

// ─── Type badge colors ────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  Blank: '#4b5563',
  Modal: '#1d4ed8',
  Sheet: '#7c3aed',
  Alert: '#b45309',
  StackedAlert: '#0f766e',
};

// ─── Shared styles ────────────────────────────────────────────────────────────

const S = {
  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', borderBottom: '1px solid #1f2937',
  } as React.CSSProperties,
  sectionLabel: {
    fontSize: 10, fontWeight: 700, color: '#9ca3af',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
  } as React.CSSProperties,
  emptyText: {
    fontSize: 11, color: '#4b5563', fontStyle: 'italic', padding: '8px 12px',
  } as React.CSSProperties,
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 12px', borderBottom: '1px solid #111827',
    cursor: 'default',
  } as React.CSSProperties,
  rowName: {
    fontSize: 11, color: '#d1d5db', flex: 1, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  typeBadge: (type: string): React.CSSProperties => ({
    fontSize: 9, fontWeight: 700, color: '#fff',
    background: TYPE_COLORS[type] ?? '#4b5563',
    borderRadius: 3, padding: '1px 5px', marginRight: 6, flexShrink: 0,
  }),
  actionBtn: {
    background: 'none', border: 'none', color: '#6b7280', fontSize: 10,
    cursor: 'pointer', padding: '2px 5px', borderRadius: 3,
  } as React.CSSProperties,
  addBtn: {
    padding: '3px 10px', background: '#1d4ed8', border: 'none',
    borderRadius: 4, color: '#fff', fontSize: 10, cursor: 'pointer',
  } as React.CSSProperties,
};

// ─── Create Popup Side Sheet ──────────────────────────────────────────────────

const POPUP_TYPES: Array<{ id: PopupModel['type']; label: string; preview: React.ReactNode }> = [
  {
    id: 'Blank',
    label: 'Blank',
    preview: (
      <svg viewBox="0 0 120 80" style={{ width: '100%', height: '100%' }}>
        <rect width="120" height="80" fill="#374151" rx="4" />
        <rect x="20" y="15" width="80" height="50" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="4 3" rx="4" />
      </svg>
    ),
  },
  {
    id: 'Modal',
    label: 'Modal',
    preview: (
      <svg viewBox="0 0 120 80" style={{ width: '100%', height: '100%' }}>
        <rect width="120" height="80" fill="#374151" rx="4" />
        <rect x="22" y="16" width="76" height="48" fill="#1f2937" rx="5" />
        <rect x="30" y="24" width="44" height="6" fill="#6b7280" rx="2" />
        <rect x="30" y="34" width="60" height="3" fill="#4b5563" rx="1" />
        <rect x="30" y="40" width="50" height="3" fill="#4b5563" rx="1" />
        <rect x="68" y="50" width="22" height="8" fill="#3b82f6" rx="3" />
      </svg>
    ),
  },
  {
    id: 'Sheet',
    label: 'Sheet',
    preview: (
      <svg viewBox="0 0 120 80" style={{ width: '100%', height: '100%' }}>
        <rect width="120" height="80" fill="#374151" rx="4" />
        <rect x="60" y="0" width="60" height="80" fill="#1f2937" rx="0" />
        <rect x="68" y="14" width="40" height="5" fill="#6b7280" rx="2" />
        <rect x="68" y="24" width="40" height="3" fill="#4b5563" rx="1" />
        <rect x="68" y="30" width="32" height="3" fill="#4b5563" rx="1" />
        <rect x="68" y="36" width="36" height="3" fill="#4b5563" rx="1" />
      </svg>
    ),
  },
  {
    id: 'Alert',
    label: 'Alert',
    preview: (
      // Toast/snackbar at bottom-right corner (no modal overlay)
      <svg viewBox="0 0 120 80" style={{ width: '100%', height: '100%' }}>
        <rect width="120" height="80" fill="#374151" rx="4" />
        {/* Page content hint */}
        <rect x="8" y="8" width="64" height="4" fill="#4b5563" rx="1" opacity="0.5" />
        <rect x="8" y="16" width="48" height="3" fill="#4b5563" rx="1" opacity="0.4" />
        {/* Toast card bottom-right */}
        <rect x="24" y="48" width="88" height="24" fill="#1f2937" rx="5" />
        {/* Icon circle */}
        <circle cx="36" cy="60" r="6" fill="#78350f" opacity="0.5" />
        <rect x="34" y="57" width="4" height="6" fill="#f59e0b" rx="1" opacity="0.8" />
        {/* Text lines */}
        <rect x="47" y="54" width="36" height="4" fill="#6b7280" rx="1.5" />
        <rect x="47" y="62" width="50" height="3" fill="#4b5563" rx="1" />
        {/* X button */}
        <line x1="104" y1="53" x2="108" y2="57" stroke="#6b7280" strokeWidth="1.5" />
        <line x1="108" y1="53" x2="104" y2="57" stroke="#6b7280" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    id: 'StackedAlert',
    label: 'Stacked Alert',
    preview: (
      // Two toast cards stacked at bottom-right
      <svg viewBox="0 0 120 80" style={{ width: '100%', height: '100%' }}>
        <rect width="120" height="80" fill="#374151" rx="4" />
        {/* Page content hint */}
        <rect x="8" y="8" width="64" height="4" fill="#4b5563" rx="1" opacity="0.5" />
        {/* Older toast (top of stack) */}
        <rect x="24" y="22" width="88" height="22" fill="#1f2937" rx="4" />
        <circle cx="34" cy="33" r="5" fill="#1e3a5f" opacity="0.7" />
        <rect x="44" y="28" width="34" height="4" fill="#6b7280" rx="1.5" />
        <rect x="44" y="35" width="50" height="3" fill="#4b5563" rx="1" />
        <line x1="104" y1="25" x2="107" y2="28" stroke="#6b7280" strokeWidth="1.5" />
        <line x1="107" y1="25" x2="104" y2="28" stroke="#6b7280" strokeWidth="1.5" />
        {/* Newer toast (bottom of stack) */}
        <rect x="24" y="50" width="88" height="22" fill="#1f2937" rx="4" />
        <circle cx="34" cy="61" r="5" fill="#1e3a5f" opacity="0.7" />
        <rect x="44" y="56" width="34" height="4" fill="#6b7280" rx="1.5" />
        <rect x="44" y="63" width="50" height="3" fill="#4b5563" rx="1" />
        <line x1="104" y1="53" x2="107" y2="56" stroke="#6b7280" strokeWidth="1.5" />
        <line x1="107" y1="53" x2="104" y2="56" stroke="#6b7280" strokeWidth="1.5" />
      </svg>
    ),
  },
];

interface CreateSheetProps {
  onClose: () => void;
  onCreated: (model: PopupModel) => void;
  /** Left offset so the sheet sits flush to the right of the left panel */
  leftOffset?: number;
}

function CreatePopupSheet({ onClose, onCreated, leftOffset = 240 }: CreateSheetProps) {
  const [name, setName] = useState('');
  const [selectedType, setSelectedType] = useState<PopupModel['type']>('Modal');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const id = `popup-${crypto.randomUUID()}`;
      const model = createPopupData({
        id,
        name: trimmed,
        type: selectedType,
        allowStacking: selectedType === 'StackedAlert',
        properties: [],
        content: STARTER_CONTENT[selectedType] ?? STARTER_CONTENT.Blank,
      });
      onCreated(model);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [name, selectedType, onCreated, onClose]);

  return (
    <>
      {/* Invisible backdrop — click outside closes */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onClick={onClose}
      />

      {/* Side sheet */}
      <div
        style={{
          position: 'fixed',
          top: 40,
          left: leftOffset,
          bottom: 0,
          width: 340,
          zIndex: 9999,
          background: '#111827',
          borderLeft: '1px solid #374151',
          boxShadow: '6px 0 20px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 12px', borderBottom: '1px solid #374151', flexShrink: 0,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#f3f4f6' }}>Create Popup</span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280',
              fontSize: 16, lineHeight: 1, padding: 4, borderRadius: 4,
              display: 'flex', alignItems: 'center',
            }}
          >✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 0' }}>
          {/* Name field */}
          <div style={{ marginBottom: 18 }}>
            <label style={{
              display: 'block', fontSize: 10, color: '#9ca3af', marginBottom: 5,
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>Name</label>
            <input
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleCreate(); }}
              placeholder="My Modal"
              style={{
                width: '100%', border: '1px solid #374151', borderRadius: 5,
                color: '#d1d5db', fontSize: 12, padding: '6px 10px', boxSizing: 'border-box',
                outline: 'none', background: '#111827',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(59,130,246,0.2)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          {/* Type grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingBottom: 16 }}>
            {POPUP_TYPES.map(pt => {
              const isSelected = selectedType === pt.id;
              return (
                <button
                  key={pt.id}
                  data-testid={`popup-type-${pt.id}`}
                  onClick={() => setSelectedType(pt.id)}
                  style={{
                    background: isSelected ? '#1e3a5f' : '#111827',
                    border: `2px solid ${isSelected ? '#3b82f6' : '#374151'}`,
                    borderRadius: 8, padding: 0, cursor: 'pointer', textAlign: 'center',
                    overflow: 'hidden', transition: 'border-color 0.12s',
                  }}
                >
                  {/* Visual preview */}
                  <div style={{
                    height: 80, background: '#1f2937', overflow: 'hidden',
                    borderBottom: `1px solid ${isSelected ? '#2563eb' : '#374151'}`,
                  }}>
                    {pt.preview}
                  </div>
                  {/* Label */}
                  <div style={{
                    padding: '7px 4px 8px',
                    fontSize: 11, fontWeight: 500,
                    color: isSelected ? '#93c5fd' : '#9ca3af',
                  }}>
                    {pt.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid #374151', flexShrink: 0,
          display: 'flex', gap: 8, justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px', background: 'none', border: '1px solid #374151',
              borderRadius: 5, color: '#9ca3af', fontSize: 11, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            data-testid="popup-create-confirm"
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            style={{
              padding: '6px 16px', background: '#1d4ed8', border: 'none',
              borderRadius: 5, color: '#fff', fontSize: 11, cursor: 'pointer',
              opacity: (!name.trim() || saving) ? 0.45 : 1,
              transition: 'opacity 0.12s',
            }}
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Properties Editor ────────────────────────────────────────────────────────

interface PropertiesEditorProps {
  model: PopupModel;
  onUpdate: (updated: PopupModel) => void;
}

function PropertiesEditor({ model, onUpdate }: PropertiesEditorProps) {
  const addProperty = useCallback(() => {
    const newProp: PopupProperty = {
      id: `prop-${crypto.randomUUID()}`,
      name: `prop${model.properties.length + 1}`,
      type: 'string',
      defaultValue: '',
    };
    const updated = { ...model, properties: [...model.properties, newProp] };
    onUpdate(updated);
    updatePopupData(updated);
  }, [model, onUpdate]);

  const updateProp = useCallback((propId: string, field: keyof PopupProperty, value: string) => {
    const updated = {
      ...model,
      properties: model.properties.map(p => p.id === propId ? { ...p, [field]: value } : p),
    };
    onUpdate(updated);
    updatePopupData(updated);
  }, [model, onUpdate]);

  const removeProp = useCallback((propId: string) => {
    const updated = { ...model, properties: model.properties.filter(p => p.id !== propId) };
    onUpdate(updated);
    updatePopupData(updated);
  }, [model, onUpdate]);

  return (
    <div style={{ padding: '0 12px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Properties</span>
        <button style={S.addBtn} onClick={addProperty} data-testid="popup-add-property">+ New</button>
      </div>
      {model.properties.length === 0 && (
        <div style={S.emptyText}>No properties yet. Add one to pass dynamic data when opening this popup.</div>
      )}
      {model.properties.map(prop => (
        <div key={prop.id} style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
          <input
            value={prop.name}
            onChange={e => updateProp(prop.id, 'name', e.target.value)}
            placeholder="name"
            style={{ flex: 2, background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 10, padding: '3px 6px' }}
          />
          <select
            value={prop.type}
            onChange={e => updateProp(prop.id, 'type', e.target.value)}
            style={{ flex: 1, background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#d1d5db', fontSize: 10, padding: '3px 4px' }}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="object">object</option>
          </select>
          <button style={{ ...S.actionBtn, color: '#ef4444', fontSize: 12 }} onClick={() => removeProp(prop.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── Model Row ────────────────────────────────────────────────────────────────

interface ModelRowProps {
  model: PopupModel;
  isOpen: boolean;
  onDelete: (id: string) => void;
  onUpdate: (updated: PopupModel) => void;
  onEdit: (model: PopupModel) => void;
}

function ModelRow({ model, isOpen, onDelete, onUpdate, onEdit }: ModelRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(model.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popup-menu]')) setMenuOpen(false);
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [menuOpen]);

  const handleRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === model.name) { setRenaming(false); return; }
    const updated = { ...model, name: trimmed };
    onUpdate(updated);
    updatePopupData(updated);
    setRenaming(false);
  }, [renameValue, model, onUpdate]);

  return (
    <>
      <div
        data-testid={`popup-model-row-${model.id}`}
        style={{ ...S.row }}
        onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        <span style={S.typeBadge(model.type)}>{model.type}</span>
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setRenaming(false); setRenameValue(model.name); } }}
            style={{ flex: 1, background: '#111827', border: '1px solid #3b82f6', borderRadius: 3, color: '#f3f4f6', fontSize: 11, padding: '1px 4px' }}
          />
        ) : (
          <span style={S.rowName}>{model.name}</span>
        )}
        <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
          {!renaming && (
            <button
              data-testid={`popup-edit-${model.id}`}
              style={{
                ...S.actionBtn, fontSize: 9, borderRadius: 3, padding: '2px 6px',
                border: isOpen ? '1px solid #ef4444' : '1px solid #3b82f6',
                color: isOpen ? '#ef4444' : '#3b82f6',
              }}
              onClick={() => onEdit(model)}
              title={isOpen ? 'Close popup' : 'Open popup in canvas'}
            >
              {isOpen ? 'Close' : 'Open'}
            </button>
          )}
          <div style={{ position: 'relative' }} data-popup-menu>
            <button
              data-testid={`popup-menu-${model.id}`}
              style={{ ...S.actionBtn, fontSize: 14, padding: '0 4px' }}
              onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
            >
              ⋮
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                data-popup-menu
                style={{ position: 'absolute', right: 0, top: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, zIndex: 9999, minWidth: 100, padding: '4px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#d1d5db', fontSize: 11, padding: '5px 12px', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                  onClick={() => { setRenaming(true); setMenuOpen(false); }}
                >
                  Rename
                </button>
                <button
                  data-testid={`popup-delete-${model.id}`}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ef4444', fontSize: 11, padding: '5px 12px', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#111827')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                  onClick={() => { onDelete(model.id); setMenuOpen(false); }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Popup component context sync ────────────────────────────────────────────
// Writes context.component.props to the global variable store so the canvas
// renderer (which renders popup nodes as regular pageNodes without a scope) can
// evaluate formulas like context.component?.props?.['uuid'] against the defaults.
// The formula evaluator reads state.context as __ctx__, so setting
// variableStore.context = { component: { props } } makes it available everywhere.
function syncPopupComponentContext(props: Record<string, unknown>) {
  getGlobalVariableStore().getState().setState(prev => ({ ...prev, context: { component: { props } } }));
}

function clearPopupComponentContext() {
  getGlobalVariableStore().getState().setState(prev => {
    const next = { ...prev };
    delete next.context;
    return next;
  });
}

// ─── Main PopupsTab ───────────────────────────────────────────────────────────

export function PopupsTab() {
  const [models, setModels] = useState<PopupModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const { enterPopupEdit, exitPopupEdit, saveEditingPopup, editingPopupIds, pageNodes } = useBuilderStore();

  // Auto-save each popup being edited whenever pageNodes changes (debounced 800 ms).
  // This ensures that changes made in the builder canvas are persisted to
  // config/popups.json without requiring the user to explicitly close the popup.
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable snapshot of IDs and save fn so the effect only fires on real pageNodes changes.
  const editingPopupIdsRef = useRef(editingPopupIds);
  const saveEditingPopupRef = useRef(saveEditingPopup);
  useEffect(() => { editingPopupIdsRef.current = editingPopupIds; }, [editingPopupIds]);
  useEffect(() => { saveEditingPopupRef.current = saveEditingPopup; }, [saveEditingPopup]);

  useEffect(() => {
    if (editingPopupIdsRef.current.length === 0) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      editingPopupIdsRef.current.forEach(id => saveEditingPopupRef.current(id));
    }, 800);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  // pageNodes reference changes on every edit — that's exactly when we want to save.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNodes]);

  useEffect(() => {
    setModels(getPopupList() as PopupModel[]);
    setLoading(false);
    // Keep in sync with external mutations (e.g. saveEditingPopup from the store)
    return subscribePopups(() => setModels(getPopupList() as PopupModel[]));
  }, []);

  const handleCreated = useCallback((model: PopupModel) => {
    setModels(prev => [...prev, model]);
    // Auto-open the newly created popup so the user lands straight in edit mode.
    handleEdit(model);
  // handleEdit is stable (useCallback with its own deps) — safe to include.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = useCallback((id: string) => {
    // If this popup is currently open for editing, remove it from the canvas first.
    if (editingPopupIds.includes(id)) {
      exitPopupEdit(id);
      usePopupStore.getState().closeByModelId(id);
      const remaining = editingPopupIds.filter(eid => eid !== id);
      if (remaining.length === 0) clearPopupComponentContext();
    }
    deletePopupData(id);
    setModels(prev => prev.filter(m => m.id !== id));
  }, [editingPopupIds, exitPopupEdit]);

  const handleUpdate = useCallback((updated: PopupModel) => {
    setModels(prev => prev.map(m => m.id === updated.id ? updated : m));
  }, []);

  const handleEdit = useCallback(async (model: PopupModel) => {
    if (editingPopupIds.includes(model.id)) {
      // Already editing this popup — exit it and close its preview instance.
      exitPopupEdit(model.id);
      usePopupStore.getState().closeByModelId(model.id);
      // Clear context.component.props when no more popups are being edited
      const remaining = editingPopupIds.filter(id => id !== model.id);
      if (remaining.length === 0) clearPopupComponentContext();
      return;
    }

    // Ensure every node in the popup content has an ID so the builder's
    // hit-test and layer selection can target them individually.
    const { node: populatedContent, changed } = ensureNodeIds(model.content as Record<string, unknown>);
    let editModel = model;
    if (changed) {
      editModel = { ...model, content: populatedContent as unknown as PopupModel['content'] };
      updatePopupData(editModel);
      setModels(prev => prev.map(m => m.id === editModel.id ? editModel : m));
    }

    // Build default props from the model's property definitions so that
    // context.component?.props?.['uuid'] formulas resolve to the defaultValue in the builder.
    const defaultProps: Record<string, unknown> = {};
    const modelProps = (editModel as unknown as { properties?: Array<{ id: string; defaultValue?: unknown }> }).properties ?? [];
    for (const p of modelProps) defaultProps[p.id] = p.defaultValue ?? '';

    // Write context.component.props to the global variable store so the canvas renderer
    // (which renders popup nodes as regular pageNodes without popup scope) can evaluate
    // formulas like context.component?.props?.['uuid'] against the default values.
    syncPopupComponentContext(defaultProps);

    // If an instance is already open for this model, refresh its props with the latest defaults.
    const existing = usePopupStore.getState().getInstancesByModel(editModel.id);
    if (existing.length > 0) {
      usePopupStore.getState().updateInstanceProps(editModel.id, defaultProps);
    } else {
      // Open a popup instance so it appears in "Opened instances". showPopups={false}
      // is passed to PageEngine when editingPopupId is set, so PopupRenderer never
      // renders this instance as an overlay — it's purely for the instances list display.
      usePopupStore.getState().openInstance(editModel.id, defaultProps, false);
    }

    // Enter popup-edit mode: popup root is appended to pageNodes so all builder
    // operations (add/delete/move/resize) work on the popup without any overlay.
    enterPopupEdit(editModel.id, populatedContent as unknown as SDUINode, editModel as unknown as Record<string, unknown>);
  }, [editingPopupIds, exitPopupEdit, enterPopupEdit]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Project popup models ────────────────────────────────────── */}
      <div style={S.sectionHeader}>
        <span style={S.sectionLabel}>⊡ Popup models</span>
        <button
          data-testid="popup-new-btn"
          style={S.addBtn}
          onClick={() => setShowCreate(true)}
        >
          + New
        </button>
      </div>

      {loading && (
        <div style={S.emptyText}>Loading…</div>
      )}

      {!loading && models.length === 0 && (
        <div style={S.emptyText}>No popup models yet. Click "+ New" to create one.</div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {models.map(model => (
          <ModelRow
            key={model.id}
            model={model}
            isOpen={editingPopupIds.includes(model.id)}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            onEdit={handleEdit}
          />
        ))}
      </div>

      {/* ── Create side sheet ─────────────────────────────────────── */}
      {showCreate && (
        <CreatePopupSheet
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
