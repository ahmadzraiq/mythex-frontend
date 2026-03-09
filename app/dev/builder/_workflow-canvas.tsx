'use client';

/**
 * WorkflowCanvas — full-screen visual workflow editor overlay.
 *
 * Layout: fixed inset-0 z-[9999] overlay with:
 *   - TopBar: workflow name (editable) | Default/On error tabs | × Close
 *   - CanvasArea: scrollable, zoom-scaled FlowRenderer (CSS flex, no graph library)
 *   - PropertiesPanel: right-side 288px panel — workflow meta or node config
 *   - BottomBar: + − zoom controls
 *
 * Pure CSS flexbox layout — no React Flow or SVG graph engine.
 * Branching = flex-row columns; loops = dashed-border containers; all via CSS.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useBuilderStore, findNode, hasFormContainerAncestor } from './_store';
import type { WorkflowCanvasTarget, WorkflowMeta } from './_store';
import { BindingIcon, isBoundValue, type FormulaValue } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Convert camelCase / snake_case / kebab-case names to human-readable text. */
export function toHumanName(name: string): string {
  if (!name) return name;
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// ─── Action step types ────────────────────────────────────────────────────────

export type ActionStepType =
  // Structural
  | 'branch'           // True/False split
  | 'multiOptionBranch'// Multi-option split
  | 'forEach'          // Iterator (for loop)
  | 'whileLoop'        // While loop
  // Loop control
  | 'breakLoop'
  | 'continueLoop'
  | 'passThroughCondition'
  // Navigation
  | 'navigateTo'
  | 'navigatePrev'
  | 'pageLoader'
  // Form (shown only when inside a FormContainer)
  | 'setFormState'
  | 'submitForm'
  | 'resetForm'
  // Actions category
  | 'changeLanguage'
  | 'changeVariableValue'
  | 'fetchCollection'
  | 'fetchCollectionsParallel'
  | 'updateCollection'
  | 'resetVariableValue'
  | 'executeComponentAction'
  | 'returnValue'
  | 'timeDelay'
  | 'uploadFile'
  // Advanced
  | 'stopPropagation'
  | 'printPdf'
  | 'copyToClipboard'
  | 'downloadFileFromUrl'
  | 'createUrlFromBase64'
  | 'encodeFileAsBase64'
  | 'openPopup'
  | 'closeAllPopups'
  // Data / API
  | 'graphql'
  | 'fetchData'
  // Project workflows
  | 'runProjectWorkflow';

export interface BranchDef {
  label: string;
  steps: ActionStep[];
}

export interface ActionStep {
  id: string;
  type: ActionStepType;
  name?: string;
  description?: string;
  disabled?: boolean;
  // Generic config — varies by type
  config?: Record<string, unknown>;
  // Named action reference — used when a step calls a named action directly
  action?: string;
  /**
   * When a step is deserialized from an ActionRef { "action": "uuid" } whose UUID
   * points to a direct (non-workflowSteps) action, this field stores the original
   * UUID so serializeStep can write it back as { "action": "uuid" } instead of
   * duplicating the full action config inline.
   */
  _actionRef?: string;
  // Structural children
  trueBranch?: ActionStep[];
  falseBranch?: ActionStep[];
  branches?: BranchDef[];
  defaultBranch?: ActionStep[];
  loopBody?: ActionStep[];
}

// ─── Trigger definitions ──────────────────────────────────────────────────────

interface TriggerOption {
  value: string;
  label: string;
}

interface TriggerCategory {
  category: string;
  options: TriggerOption[];
}

const ELEMENT_TRIGGERS: Record<string, TriggerOption[]> = {
  InputField: [
    { value: 'change', label: 'On change' },
    { value: 'initValueChange', label: 'On init value change' },
    { value: 'enterKey', label: 'On enter key' },
    { value: 'focus', label: 'On focus' },
    { value: 'blur', label: 'On blur' },
  ],
  TextareaInput: [
    { value: 'change', label: 'On change' },
    { value: 'initValueChange', label: 'On init value change' },
    { value: 'enterKey', label: 'On enter key' },
    { value: 'focus', label: 'On focus' },
    { value: 'blur', label: 'On blur' },
  ],
  Switch: [
    { value: 'change', label: 'On change' },
    { value: 'initValueChange', label: 'On init value change' },
  ],
  Checkbox: [
    { value: 'valueChange', label: 'On change' },
    { value: 'initValueChange', label: 'On init value change' },
  ],
  Button: [
    { value: 'focus', label: 'On focus' },
    { value: 'blur', label: 'On blur' },
  ],
  FormContainer: [
    { value: 'submit',                label: 'On submit' },
    { value: 'submitValidationError', label: 'On submit validation error' },
  ],
};

const UNIVERSAL_TRIGGER_CATEGORIES: TriggerCategory[] = [
  {
    category: 'Mouse',
    options: [
      { value: 'click', label: 'On click' },
      { value: 'doubleClick', label: 'On double click' },
      { value: 'rightClick', label: 'On right click' },
      { value: 'mouseDown', label: 'On mouse down' },
      { value: 'mouseUp', label: 'On mouse up' },
      { value: 'mouseMove', label: 'On mouse move' },
      { value: 'mouseEnter', label: 'On mouse enter' },
      { value: 'mouseLeave', label: 'On mouse leave' },
    ],
  },
  {
    category: 'Touch',
    options: [
      { value: 'touchStart', label: 'On touch start' },
      { value: 'touchMove', label: 'On touch move' },
      { value: 'touchEnd', label: 'On touch end' },
      { value: 'touchCancel', label: 'On touch cancel' },
    ],
  },
  {
    category: 'Other',
    options: [
      { value: 'scroll', label: 'On scroll' },
    ],
  },
  {
    category: 'Lifecycle',
    options: [
      { value: 'created', label: 'On created' },
      { value: 'mounted', label: 'On mounted' },
      { value: 'beforeUnmount', label: 'Before unmount' },
    ],
  },
];

function getTriggerCategories(nodeType?: string): TriggerCategory[] {
  const elementOptions = nodeType ? (ELEMENT_TRIGGERS[nodeType] ?? []) : [];
  const cats: TriggerCategory[] = [];
  if (elementOptions.length) {
    cats.push({ category: 'Element triggers', options: elementOptions });
  }
  return [...cats, ...UNIVERSAL_TRIGGER_CATEGORIES];
}

function getTriggerLabel(value: string, nodeType?: string): string {
  const all = getTriggerCategories(nodeType).flatMap(c => c.options);
  return all.find(o => o.value === value)?.label ?? value;
}

// Inline SVG icon atoms — 14×14, inherits currentColor
const TI = {
  /** Cursor pointer with click sparkle (click / dblClick / rightClick) */
  Click: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 9l11 2.5-4 1.5 1.5 4L9 9z"/>
      <path d="M7 2v2M2 7h2M4.22 4.22l1.42 1.42"/>
    </svg>
  ),
  /** Plain outlined circle (mouse down / up / move / enter / leave) */
  Circle: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9"/>
    </svg>
  ),
  /** Fingerprint (touch events) */
  Fingerprint: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/>
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
      <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
      <path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>
    </svg>
  ),
  /** Zap / lightning bolt (scroll, lifecycle created) */
  Zap: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  /** Rotate-ccw arrow (On mounted) */
  Rotate: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
    </svg>
  ),
  /** Server stacked rows (Before unmount) */
  Server: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2"/>
      <rect x="2" y="14" width="20" height="8" rx="2"/>
      <line x1="6" y1="6" x2="6.01" y2="6"/>
      <line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
  ),
  /** Pencil/edit (element change triggers) */
  Edit: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  /** Eye (focus / blur) */
  Eye: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  /** Corner-down-left arrow (Enter key) */
  Enter: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 10 4 15 9 20"/>
      <path d="M20 4v7a4 4 0 0 1-4 4H4"/>
    </svg>
  ),
};

function getTriggerIcon(value: string): React.ReactNode {
  switch (value) {
    case 'click':
    case 'doubleClick':
    case 'rightClick':
      return <TI.Click />;
    case 'mouseDown':
    case 'mouseUp':
    case 'mouseMove':
    case 'mouseEnter':
    case 'mouseLeave':
      return <TI.Circle />;
    case 'touchStart':
    case 'touchMove':
    case 'touchEnd':
    case 'touchCancel':
      return <TI.Fingerprint />;
    case 'scroll':
    case 'created':
      return <TI.Zap />;
    case 'mounted':
      return <TI.Rotate />;
    case 'beforeUnmount':
      return <TI.Server />;
    case 'change':
    case 'initValueChange':
    case 'valueChange':
      return <TI.Edit />;
    case 'focus':
    case 'blur':
      return <TI.Eye />;
    case 'enterKey':
      return <TI.Enter />;
    default:
      return <TI.Zap />;
  }
}

// ─── Action type definitions ──────────────────────────────────────────────────

interface ActionTypeDef {
  type: ActionStepType;
  label: string;
  icon: string;
  isStructural?: boolean;
}

// ─── WorkflowBindButton ───────────────────────────────────────────────────────
// A chain-link button that opens a dropdown list of available named workflows.
// Used in the runProjectWorkflow step config and the right panel's workflow rows.

interface WorkflowBindButtonProps {
  /** Currently bound workflow UUID, or empty string if unbound */
  value: string;
  onChange: (uuid: string) => void;
}

export function WorkflowBindButton({ value, onChange }: WorkflowBindButtonProps) {
  const { pageWorkflowMeta } = useBuilderStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const rawDisplayName = value && pageWorkflowMeta[value]?.name ? pageWorkflowMeta[value].name : value || '';
  const displayName = rawDisplayName ? toHumanName(rawDisplayName) : 'Bind workflow';
  const isBound = Boolean(value);

  const allWorkflows = Object.values(pageWorkflowMeta)
    .filter(w => !w.isSystem)
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  const filtered = search
    ? allWorkflows.filter(w => (w.name ?? w.id).toLowerCase().includes(search.toLowerCase()))
    : allWorkflows;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      {/* Chain-link bind icon */}
      <button
        type="button"
        title={isBound ? 'Change workflow binding' : 'Bind to a workflow'}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 22, height: 22, flexShrink: 0, cursor: 'pointer',
          border: 'none', borderRadius: 6,
          background: isBound ? '#3730a3' : '#1f2937',
          color: isBound ? '#a5b4fc' : '#6b7280',
          transition: 'background 0.15s, color 0.15s',
          padding: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l2-2a3.5 3.5 0 0 0-4.95-4.95l-1.1 1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0l-2 2a3.5 3.5 0 0 0 4.95 4.95l1.1-1.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Bound workflow name pill */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          flex: 1, textAlign: 'left', background: isBound ? '#1e1b4b' : '#111827',
          border: `1px solid ${isBound ? '#3730a3' : '#374151'}`,
          borderRadius: 6, padding: '4px 8px', fontSize: 11,
          color: isBound ? '#a5b4fc' : '#6b7280', cursor: 'pointer',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {displayName}
      </button>

      {/* Clear button when bound */}
      {isBound && (
        <button
          type="button"
          title="Unbind workflow"
          onClick={e => { e.stopPropagation(); onChange(''); }}
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
        >
          ×
        </button>
      )}

      {/* Dropdown */}
      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
            marginTop: 4, background: '#1f2937', border: '1px solid #374151',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
            minWidth: 220,
          }}
        >
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #374151' }}>
            <input
              autoFocus
              style={{ width: '100%', background: '#111827', border: '1px solid #374151', borderRadius: 4, color: '#e5e7eb', fontSize: 11, padding: '4px 8px', outline: 'none', boxSizing: 'border-box' }}
              placeholder="Search workflows…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 11, color: '#6b7280' }}>No workflows found</div>
            )}
            {filtered.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={e => { e.stopPropagation(); onChange(w.id); setOpen(false); setSearch(''); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 12px', background: w.id === value ? '#312e81' : 'transparent',
                  border: 'none', color: w.id === value ? '#c7d2fe' : '#e5e7eb',
                  fontSize: 11, cursor: 'pointer',
                }}
                onMouseEnter={e => { if (w.id !== value) (e.currentTarget as HTMLElement).style.background = '#374151'; }}
                onMouseLeave={e => { if (w.id !== value) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <div style={{ fontWeight: 600 }}>{toHumanName(w.name ?? w.id)}</div>
                {w.trigger && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>On {w.trigger}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ACTION_CATEGORIES: { category: string; items: ActionTypeDef[] }[] = [
  {
    category: 'Data / API',
    items: [
      { type: 'graphql', label: 'GraphQL', icon: '⬡' },
      { type: 'fetchData', label: 'Fetch data (REST)', icon: '⬡' },
    ],
  },
  {
    category: 'Branching',
    items: [
      { type: 'branch', label: 'True/False split', icon: '⟐', isStructural: true },
      { type: 'multiOptionBranch', label: 'Multi-option split', icon: '⟐', isStructural: true },
      { type: 'forEach', label: 'Iterator (for loop)', icon: '↻', isStructural: true },
      { type: 'whileLoop', label: 'While loop', icon: '∞', isStructural: true },
    ],
  },
  {
    category: 'Loop',
    items: [
      { type: 'breakLoop', label: 'Break loop', icon: '⊙' },
      { type: 'continueLoop', label: 'Continue loop', icon: '→' },
      { type: 'passThroughCondition', label: 'Pass through condition', icon: '▽' },
    ],
  },
  {
    category: 'Navigation',
    items: [
      { type: 'navigateTo', label: 'Navigate to', icon: '🔗' },
      { type: 'navigatePrev', label: 'Navigate to previous page', icon: '↩' },
      { type: 'pageLoader', label: 'Page loader', icon: '⚙' },
    ],
  },
  {
    category: 'Actions',
    items: [
      { type: 'runProjectWorkflow', label: 'Call workflow', icon: '▶' },
      { type: 'changeLanguage', label: 'Change language', icon: '↗' },
      { type: 'changeVariableValue', label: 'Change variable value', icon: '⇄' },
      { type: 'fetchCollection', label: 'Fetch collection', icon: '🗄' },
      { type: 'fetchCollectionsParallel', label: 'Fetch collections in parallel', icon: '🗄' },
      { type: 'updateCollection', label: 'Update collection', icon: '🗄' },
      { type: 'resetVariableValue', label: 'Reset variable value', icon: '⇄' },
      { type: 'executeComponentAction', label: 'Execute component action', icon: '⚡' },
      { type: 'returnValue', label: 'Return a value', icon: '⚡' },
      { type: 'timeDelay', label: 'Time delay', icon: '⏱' },
      { type: 'uploadFile', label: 'Upload file', icon: '⬆' },
    ],
  },
  {
    category: 'Advanced',
    items: [
      { type: 'stopPropagation', label: 'Stop click propagation', icon: '🖱' },
      { type: 'printPdf', label: 'Print PDF', icon: '🖨' },
      { type: 'copyToClipboard', label: 'Copy to clipboard', icon: '📋' },
      { type: 'downloadFileFromUrl', label: 'Download file from URL', icon: '</>' },
      { type: 'createUrlFromBase64', label: 'Create URL from Base64', icon: '</>' },
      { type: 'encodeFileAsBase64', label: 'Encode file as Base64', icon: '</>' },
    ],
  },
  {
    category: 'Popup',
    items: [
      { type: 'openPopup', label: 'Open popup', icon: '⊞' },
      { type: 'closeAllPopups', label: 'Close all popups', icon: '⊞' },
    ],
  },
];

// Form-specific actions — injected into TypeSearchDropdown only when inside a FormContainer
const FORM_ACTION_CATEGORY: { category: string; items: ActionTypeDef[] } = {
  category: 'Other',
  items: [
    { type: 'setFormState', label: 'Set form state', icon: '⊟' },
    { type: 'submitForm',   label: 'Submit form',   icon: '⊟' },
    { type: 'resetForm',    label: 'Reset form',    icon: '⊟' },
  ],
};

/** Convert a raw JSON action value (from node.actions array) to a canvas ActionStep. */
function deserializeStep(raw: unknown, id: string, directActionsMap?: Record<string, Record<string, unknown>>): ActionStep {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') return { id, type: 'graphql' };
  // ActionRef: { "action": "uuid" } — a step that calls another action by ID.
  // Look up the referenced action in directActionsMap first so a graphql/fetch/navigate
  // action shows as its real type instead of always appearing as "Call workflow".
  if (typeof obj.action === 'string' && !obj.type) {
    const refDef = directActionsMap?.[obj.action as string];
    if (refDef && refDef.type && refDef.type !== 'workflowSteps') {
      // Inline the referenced action's definition as a typed step so the canvas
      // displays (and lets the user edit) its real configuration.
      const { type, name: refName, ...refConfig } = refDef;
      return { id, type: type as ActionStepType, name: (refName as string | undefined) ?? (obj.action as string), _actionRef: obj.action as string, ...refConfig };
    }
    // Unknown or workflowSteps reference — keep as "Call workflow"
    return { id, type: 'runProjectWorkflow', action: obj.action as string, config: { workflowId: obj.action as string }, name: obj.action as string };
  }
  // Already a typed step — cast as-is
  return { id, ...(obj as Omit<ActionStep, 'id'>) };
}

/** Convert canvas ActionStep back to raw JSON for storage on the node. */
function serializeStep(step: ActionStep): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, _actionRef, ...rest } = step as ActionStep & { _actionRef?: string };
  // If this step was deserialized from an ActionRef (e.g. { "action": "uuid" }), write it
  // back as an ActionRef to keep the JSON clean and avoid duplicating mutation config.
  if (_actionRef) return { action: _actionRef };
  return rest;
}

function getActionDef(type: ActionStepType): ActionTypeDef | undefined {
  // Search FORM_ACTION_CATEGORY first so form types resolve their human labels
  const formFound = FORM_ACTION_CATEGORY.items.find(i => i.type === type);
  if (formFound) return formFound;
  for (const cat of ACTION_CATEGORIES) {
    const found = cat.items.find(i => i.type === type);
    if (found) return found;
  }
  return undefined;
}

function getActionLabel(type: ActionStepType): string {
  return getActionDef(type)?.label ?? type;
}

function getActionIcon(type: ActionStepType): string {
  return getActionDef(type)?.icon ?? '⚡';
}

function isStructural(type: ActionStepType): boolean {
  return getActionDef(type)?.isStructural ?? false;
}

function isConfigured(step: ActionStep): boolean {
  return Boolean(step.type);
}

function canTest(step: ActionStep): boolean {
  if (!isConfigured(step)) return false;
  if (step.type === 'breakLoop' || step.type === 'continueLoop') return false;
  return true;
}

function generateId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createPlaceholderStep(): ActionStep {
  return { id: generateId(), type: 'graphql' };
}

// ─── Styles (scoped to canvas) ────────────────────────────────────────────────
// Dark theme matching the main builder canvas (#1a1a2e canvas, #0f172a top bar, #111827 panels)

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 9999,
    background: '#0f172a',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    height: 48,
    borderBottom: '1px solid #1f2937',
    background: '#0f172a',
    flexShrink: 0,
    gap: 12,
  },
  tabPill: (active: boolean) => ({
    padding: '4px 14px',
    borderRadius: 20,
    background: active ? '#1d4ed8' : 'transparent',
    color: active ? '#fff' : '#9ca3af',
    fontSize: 13,
    fontWeight: 500,
    border: 'none',
    cursor: 'pointer',
  }),
  closeBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
    color: '#9ca3af',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
  },
  contentArea: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  canvasArea: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative' as const,
    background: '#1a1a2e',
    cursor: 'default',
  },
  flowColumn: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 0,
    minWidth: 280,
  },
  // Vertical connector line
  vLine: {
    width: 1,
    height: 16,
    background: '#374151',
    flexShrink: 0,
  },
  // Arrow head (triangle pointing down)
  arrowHead: {
    width: 0,
    height: 0,
    borderLeft: '4px solid transparent',
    borderRight: '4px solid transparent',
    borderTop: '6px solid #374151',
    flexShrink: 0,
  },
  // Insert "+" circle between nodes
  insertBtn: (hovered: boolean) => ({
    width: 20,
    height: 20,
    borderRadius: '50%',
    border: `1px solid ${hovered ? '#3b82f6' : '#374151'}`,
    background: hovered ? '#1e3a5f' : '#1e293b',
    color: hovered ? '#3b82f6' : '#6b7280',
    fontSize: 14,
    lineHeight: '18px',
    textAlign: 'center' as const,
    cursor: 'pointer',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  }),
  // Action card
  card: (selected: boolean, incomplete: boolean) => ({
    width: 280,
    background: '#1e293b',
    border: `1px solid ${selected ? '#3b82f6' : '#374151'}`,
    borderRadius: 12,
    padding: '12px 14px',
    cursor: 'pointer',
    boxShadow: selected ? '0 0 0 3px rgba(59,130,246,0.2)' : '0 1px 4px rgba(0,0,0,0.3)',
    flexShrink: 0,
    userSelect: 'none' as const,
  }),
  cardTopRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  cardIcon: {
    fontSize: 13,
    color: '#9ca3af',
    flexShrink: 0,
  },
  cardName: {
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
    color: '#f3f4f6',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  cardSubtext: (incomplete: boolean) => ({
    fontSize: 11,
    color: incomplete ? '#f59e0b' : '#6b7280',
    marginTop: 2,
  }),
  testBtn: (disabled: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 11,
    color: disabled ? '#374151' : '#9ca3af',
    background: 'none',
    border: `1px solid ${disabled ? '#1f2937' : '#374151'}`,
    borderRadius: 5,
    padding: '2px 7px',
    cursor: disabled ? 'default' : 'pointer',
    flexShrink: 0,
  }),
  moreBtn: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 2px',
    lineHeight: 1,
    flexShrink: 0,
  },
  // Structural pill node
  pillNode: (selected: boolean, dashed?: boolean) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 16px',
    borderRadius: 24,
    border: `${dashed ? '2px dashed' : '1px solid'} ${selected ? '#3b82f6' : '#374151'}`,
    background: '#1e293b',
    fontSize: 13,
    fontWeight: 500,
    color: '#e5e7eb',
    cursor: 'pointer',
    boxShadow: selected ? '0 0 0 3px rgba(59,130,246,0.2)' : '0 1px 4px rgba(0,0,0,0.3)',
    userSelect: 'none' as const,
    flexShrink: 0,
  }),
  // Branch horizontal split line
  branchHLine: (width: number) => ({
    width,
    height: 1,
    background: '#374151',
    flexShrink: 0,
  }),
  // Branch rejoin U-shape (bottom 3 borders, no top)
  branchRejoin: (width: number) => ({
    width,
    height: 16,
    borderBottom: '1px solid #374151',
    borderLeft: '1px solid #374151',
    borderRight: '1px solid #374151',
    borderRadius: '0 0 8px 8px',
    flexShrink: 0,
  }),
  // Loop dashed container
  loopContainer: {
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 0,
    position: 'relative' as const,
    minWidth: 312,
    paddingLeft: 24,
    paddingRight: 24,
  },
  endLoopLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#9ca3af',
    background: '#1e293b',
    border: '1px solid #374151',
    borderRadius: 6,
    padding: '4px 12px',
  },
  // Add action text link
  addActionLink: {
    fontSize: 12,
    fontWeight: 600,
    color: '#9ca3af',
    cursor: 'pointer',
    background: 'rgba(107,114,128,0.10)',
    border: '1px solid rgba(107,114,128,0.25)',
    borderRadius: 20,
    padding: '4px 14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  // Trigger pill
  triggerPill: (clickable: boolean) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 18px',
    borderRadius: 24,
    border: '1px solid #374151',
    background: '#1e293b',
    fontSize: 13,
    fontWeight: 500,
    color: clickable ? '#e5e7eb' : '#6b7280',
    cursor: clickable ? 'pointer' : 'default',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    userSelect: 'none' as const,
    position: 'relative' as const,
  }),
  // Right panel
  rightPanel: {
    width: 288,
    borderLeft: '1px solid #1f2937',
    background: '#111827',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    flexShrink: 0,
  },
  rightPanelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid #1f2937',
    flexShrink: 0,
  },
  rightPanelBody: {
    flex: 1,
    overflow: 'auto',
    padding: '12px',
  },
  // Form field styles
  fieldLabel: {
    fontSize: 11,
    color: '#9ca3af',
    marginBottom: 4,
    marginTop: 10,
    display: 'block',
  },
  fieldInput: {
    width: '100%',
    fontSize: 12,
    padding: '6px 8px',
    border: '1px solid #374151',
    borderRadius: 6,
    color: '#f3f4f6',
    background: '#1e293b',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  fieldSelect: {
    width: '100%',
    fontSize: 12,
    padding: '6px 8px',
    border: '1px solid #374151',
    borderRadius: 6,
    color: '#f3f4f6',
    background: '#1e293b',
    boxSizing: 'border-box' as const,
    appearance: 'none' as const,
  },
  toggleGroup: {
    display: 'flex',
    border: '1px solid #374151',
    borderRadius: 6,
    overflow: 'hidden',
  },
  toggleBtn: (active: boolean) => ({
    flex: 1,
    padding: '5px 0',
    background: active ? '#1f2937' : 'transparent',
    border: 'none',
    fontSize: 12,
    color: active ? '#f3f4f6' : '#6b7280',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  }),
  // Dropdown/popover
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    zIndex: 100,
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    minWidth: 240,
    maxHeight: 360,
    overflow: 'auto',
    marginTop: 4,
  },
  dropdownSearch: {
    width: '100%',
    padding: '8px 12px',
    border: 'none',
    borderBottom: '1px solid #374151',
    fontSize: 12,
    color: '#f3f4f6',
    background: 'transparent',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  dropdownCategory: {
    fontSize: 10,
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    padding: '8px 12px 4px',
    letterSpacing: '0.05em',
  },
  dropdownItem: (active: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 12px',
    fontSize: 12,
    color: '#e5e7eb',
    background: active ? '#1d4ed8' : 'transparent',
    cursor: 'pointer',
    border: 'none',
    width: '100%',
    textAlign: 'left' as const,
  }),
  // Context menu
  contextMenu: {
    position: 'fixed' as const,
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 8,
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    zIndex: 10000,
    minWidth: 180,
    overflow: 'hidden',
  },
  contextItem: (danger?: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '7px 14px',
    fontSize: 12,
    color: danger ? '#f87171' : '#e5e7eb',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left' as const,
  }),
  // Bottom zoom bar
  bottomBar: {
    position: 'absolute' as const,
    bottom: 16,
    right: 16 + 288 + 8,
    display: 'flex',
    gap: 4,
  },
  zoomBtn: {
    width: 32,
    height: 32,
    background: '#1e293b',
    border: '1px solid #374151',
    borderRadius: 6,
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    color: '#e5e7eb',
  },
  infoBox: {
    background: '#1e3a5f',
    border: '1px solid #1d4ed8',
    borderRadius: 6,
    padding: '5px 8px',
    fontSize: 11,
    color: '#93c5fd',
    lineHeight: 1.4,
    marginTop: 8,
  },
  helpText: {
    fontSize: 11,
    color: '#6b7280',
    lineHeight: 1.5,
    marginTop: 8,
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 6,
    padding: '8px 10px',
  },
  warnBox: {
    background: '#451a03',
    border: '1px solid #92400e',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 11,
    color: '#fbbf24',
    marginTop: 4,
  },
};

// ─── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  step: ActionStep;
  path: (string | number)[];
}

function ContextMenuPopup({
  state,
  copiedStep,
  onClose,
  onDisable,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
}: {
  state: ContextMenuState;
  copiedStep: ActionStep | null;
  onClose: () => void;
  onDisable: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const canTestStep = canTest(state.step);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-testid="workflow-context-menu"]')) onClose();
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  const items: ({ label: string; shortcut?: string; action: () => void; danger?: boolean } | null)[] = [
    canTestStep ? { label: 'Test action', shortcut: 'ENTER', action: () => { onClose(); } } : null,
    { label: state.step.disabled ? 'Enable' : 'Disable', action: () => { onDisable(); onClose(); } },
    null,
    { label: 'Copy action', shortcut: '⌘C', action: () => { onCopy(); onClose(); } },
    copiedStep ? { label: 'Paste action', shortcut: '⌘V', action: () => { onPaste(); onClose(); } } : null,
    { label: 'Duplicate action', shortcut: '⌘D', action: () => { onDuplicate(); onClose(); } },
    null,
    { label: 'Delete action', shortcut: 'DEL', action: () => { onDelete(); onClose(); }, danger: true },
  ];

  return (
    <div
      data-testid="workflow-context-menu"
      style={{ ...S.contextMenu, left: state.x, top: state.y }}
      onMouseDown={e => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={i} style={{ height: 1, background: '#f3f4f6', margin: '2px 0' }} />
        ) : (
          <button
            key={i}
            style={S.contextItem(item.danger)}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = item.danger ? '#450a0a' : '#374151'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            onClick={item.action}
          >
            <span>{item.label}</span>
            {item.shortcut && <span style={{ fontSize: 10, color: '#9ca3af' }}>{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}

// ─── Add Action Popover ───────────────────────────────────────────────────────

function AddActionPopover({
  copiedStep,
  onSelect,
  onPaste,
  onClose,
  isFormContext = false,
}: {
  copiedStep: ActionStep | null;
  onSelect: (type: ActionStepType) => void;
  onPaste: () => void;
  onClose: () => void;
  isFormContext?: boolean;
}) {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-popover="add-action"]')) onClose();
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  const allCategories = isFormContext
    ? [FORM_ACTION_CATEGORY, ...ACTION_CATEGORIES]
    : ACTION_CATEGORIES;

  const q = search.toLowerCase();
  const filtered = allCategories.map(cat => ({
    ...cat,
    items: cat.items.filter(i => i.label.toLowerCase().includes(q)),
  })).filter(cat => cat.items.length > 0);

  return (
    <div data-popover="add-action" data-testid="add-action-popover" style={{ ...S.dropdown, width: 260 }}>
      <input
        ref={searchRef}
        style={S.dropdownSearch}
        placeholder="Search actions…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {copiedStep && !q && (
        <button
          style={{ ...S.dropdownItem(false), fontWeight: 600, borderBottom: '1px solid #374151' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#374151'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          onClick={() => { onPaste(); onClose(); }}
        >
          📋 Paste action
        </button>
      )}
      {filtered.map(cat => (
        <div key={cat.category}>
          <div style={S.dropdownCategory}>{cat.category}</div>
          {cat.items.map(item => (
            <button
              key={item.type}
              style={S.dropdownItem(false)}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#374151'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              onClick={() => { onSelect(item.type); onClose(); }}
            >
              <span style={{ fontSize: 12 }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Trigger Dropdown ─────────────────────────────────────────────────────────

function TriggerDropdown({
  value,
  nodeType,
  onChange,
  onClose,
}: {
  value: string;
  nodeType?: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const cats = getTriggerCategories(nodeType);
  const q = search.toLowerCase();
  const filtered = cats.map(cat => ({
    ...cat,
    options: cat.options.filter(o => o.label.toLowerCase().includes(q)),
  })).filter(cat => cat.options.length > 0);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="trigger"]')) onClose();
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [onClose]);

  return (
    <div data-popover="trigger" data-testid="workflow-trigger-dropdown" style={{ ...S.dropdown, width: 240 }}>
      <input
        autoFocus
        style={S.dropdownSearch}
        placeholder="Search…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {filtered.map(cat => (
        <div key={cat.category}>
          <div style={S.dropdownCategory}>{cat.category}</div>
          {cat.options.map(opt => (
            <button
              key={opt.value}
              style={S.dropdownItem(opt.value === value)}
              onClick={() => { onChange(opt.value); onClose(); }}
            >
              <span style={{ display: 'flex', alignItems: 'center', color: '#9ca3af', flexShrink: 0 }}>
                {getTriggerIcon(opt.value)}
              </span>
              <span style={{ flex: 1 }}>{opt.label}</span>
              {opt.value === value && <span style={{ color: '#3b82f6', fontSize: 10 }}>✓</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Type search dropdown (used inside NodePropsPanel) ────────────────────────

function TypeSearchDropdown({
  value,
  onChange,
  isFormContext = false,
}: {
  value: ActionStepType | '';
  onChange: (type: ActionStepType) => void;
  isFormContext?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover="type-search"]')) {
        setOpen(false);
        setSearch('');
      }
    };
    window.addEventListener('mousedown', handler, true);
    return () => window.removeEventListener('mousedown', handler, true);
  }, [open]);

  const allCategories = isFormContext
    ? [FORM_ACTION_CATEGORY, ...ACTION_CATEGORIES]
    : ACTION_CATEGORIES;

  const q = search.toLowerCase();
  const filtered = allCategories.map(cat => ({
    ...cat,
    items: cat.items.filter(i => !i.isStructural && i.type !== 'passThroughCondition' && i.label.toLowerCase().includes(q)),
  })).filter(cat => cat.items.length > 0);

  const allItems = allCategories.flatMap(c => c.items);
  const currentLabel = value
    ? allItems.find(i => i.type === value)?.label ?? value
    : 'Choose an action';

  const currentIcon = value
    ? allItems.find(i => i.type === value)?.icon
    : null;

  return (
    <div ref={wrapperRef} data-popover="type-search" style={{ position: 'relative', width: '100%' }}>
      {/* Trigger button — same styling as fieldSelect */}
      <button
        data-testid="type-search-trigger"
        style={{
          ...S.fieldSelect,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          textAlign: 'left',
          paddingRight: 28,
        }}
        onClick={() => { setOpen(v => !v); setSearch(''); }}
      >
        {currentIcon && <span style={{ fontSize: 12, flexShrink: 0 }}>{currentIcon}</span>}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value ? '#f3f4f6' : '#6b7280' }}>
          {currentLabel}
        </span>
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#6b7280', pointerEvents: 'none' }}>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            ...S.dropdown,
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 300,
            minWidth: 'unset',
            width: '100%',
            maxHeight: 320,
          }}
        >
          <input
            ref={searchRef}
            style={S.dropdownSearch}
            placeholder="Search actions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="type-search-input"
          />
          {filtered.map(cat => (
            <div key={cat.category}>
              <div style={S.dropdownCategory}>{cat.category}</div>
              {cat.items.map(item => (
                <button
                  key={item.type}
                  style={S.dropdownItem(item.type === value)}
                  onMouseEnter={e => {
                    if (item.type !== value) (e.currentTarget as HTMLButtonElement).style.background = '#374151';
                  }}
                  onMouseLeave={e => {
                    if (item.type !== value) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }}
                  onClick={() => { onChange(item.type as ActionStepType); setOpen(false); setSearch(''); }}
                  data-testid={`type-option-${item.type}`}
                >
                  <span style={{ fontSize: 12 }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.type === value && <span style={{ color: '#3b82f6', fontSize: 10 }}>✓</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Properties Panel ─────────────────────────────────────────────────────────

function WorkflowMetaPanel({
  meta,
  onChange,
}: {
  meta: WorkflowMeta;
  onChange: (patch: Partial<WorkflowMeta>) => void;
}) {
  return (
    <div>
      <label style={S.fieldLabel}>Name</label>
      <input
        style={S.fieldInput}
        value={meta.name}
        placeholder="Workflow name"
        onChange={e => onChange({ name: e.target.value })}
      />
      {!meta.name.trim() && (
        <div style={{ ...S.warnBox, marginTop: 4 }}>⊕ A name is required.</div>
      )}

      <label style={{ ...S.fieldLabel, marginTop: 12 }}>Description</label>
      <textarea
        style={{ ...S.fieldInput, minHeight: 64, resize: 'vertical' }}
        value={meta.description ?? ''}
        placeholder="Description…"
        onChange={e => onChange({ description: e.target.value })}
      />
    </div>
  );
}

// ─── Shared canvas helpers ────────────────────────────────────────────────────

/** Bigger pill-style On/Off toggle matching the right panel's OnOffToggle */
function CanvasOnOffToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const base: React.CSSProperties = {
    padding: '4px 16px', fontSize: 11, border: 'none', borderRadius: 3,
    cursor: 'pointer', fontWeight: 500,
  };
  return (
    <div style={{ display: 'flex', background: '#1f2937', borderRadius: 4, padding: 2, gap: 2 }}>
      <button style={{ ...base, background: value ? '#374151' : 'transparent', color: value ? '#f3f4f6' : '#6b7280' }}
        onClick={() => onChange(true)}>On</button>
      <button style={{ ...base, background: !value ? '#374151' : 'transparent', color: !value ? '#f3f4f6' : '#6b7280' }}
        onClick={() => onChange(false)}>Off</button>
    </div>
  );
}

// ─── NavigateToConfig ─────────────────────────────────────────────────────────

type QueryParam = { name: string; value: FormulaValue };



function NavigateToConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [openField, setOpenField] = useState<'externalUrl' | 'path' | 'queries' | `query-${number}` | `query-name-${number}` | null>(null);
  const queryParams: QueryParam[] = Array.isArray(cfg.queryParams) ? (cfg.queryParams as QueryParam[]) : [];

  function setQueryParam(idx: number, patch: Partial<QueryParam>) {
    const next = queryParams.map((q, i) => i === idx ? { ...q, ...patch } : q);
    setCfg('queryParams', next);
  }

  function addQueryParam() {
    setCfg('queryParams', [...queryParams, { name: '', value: null }]);
  }

  function removeQueryParam(idx: number) {
    setCfg('queryParams', queryParams.filter((_, i) => i !== idx));
  }

  const isExternal = (cfg.linkType as string) === 'external';

  return (
    <>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>Link type</label>
      <div style={S.toggleGroup}>
        <button style={S.toggleBtn(!isExternal)} onClick={() => setCfg('linkType', 'internal')}>Internal link</button>
        <button style={S.toggleBtn(isExternal)} onClick={() => setCfg('linkType', 'external')}>External link</button>
      </div>

      {isExternal ? (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>External URL *</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {isBoundValue(cfg.externalUrl as FormulaValue) ? (
              <button
                onClick={() => setOpenField(f => f === 'externalUrl' ? null : 'externalUrl')}
                style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                  borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                  textAlign: 'left' }}
              >ƒ Edit formula</button>
            ) : (
              <input
                style={{ ...S.fieldInput, flex: 1 }}
                placeholder="Enter an URL"
                value={typeof cfg.externalUrl === 'string' ? cfg.externalUrl : ''}
                onChange={e => setCfg('externalUrl', e.target.value)}
              />
            )}
            <BindingIcon
              isBound={isBoundValue(cfg.externalUrl as FormulaValue)}
              onClick={() => setOpenField(f => f === 'externalUrl' ? null : 'externalUrl')}
            />
          </div>
          {openField === 'externalUrl' && (
            <FormulaEditor
              label="External URL"
              value={(cfg.externalUrl as FormulaValue) ?? null}
              onChange={v => { setCfg('externalUrl', v); setOpenField(null); }}
              onClose={() => setOpenField(null)}
              anchorRight={292}
            />
          )}
        </>
      ) : (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Path *</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {isBoundValue(cfg.path as FormulaValue) ? (
              <button
                onClick={() => setOpenField(f => f === 'path' ? null : 'path')}
                style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                  borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                  textAlign: 'left' }}
              >ƒ Edit formula</button>
            ) : (
              <input
                style={{ ...S.fieldInput, flex: 1 }}
                placeholder="Enter a path"
                value={typeof cfg.path === 'string' ? cfg.path : ''}
                onChange={e => setCfg('path', e.target.value)}
              />
            )}
            <BindingIcon
              isBound={isBoundValue(cfg.path as FormulaValue)}
              onClick={() => setOpenField(f => f === 'path' ? null : 'path')}
            />
          </div>
          {openField === 'path' && (
            <FormulaEditor
              label="Path"
              value={(cfg.path as FormulaValue) ?? null}
              onChange={v => { setCfg('path', v); setOpenField(null); }}
              onClose={() => setOpenField(null)}
              anchorRight={292}
            />
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <label style={S.fieldLabel}>Open in a new tab</label>
            <CanvasOnOffToggle value={!!(cfg.newTab)} onChange={v => setCfg('newTab', v)} />
          </div>

          {/* Queries */}
          {isBoundValue(cfg.queries as FormulaValue) ? (
            <>
              <label style={{ ...S.fieldLabel, marginTop: 12 }}>Queries</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={() => setOpenField(f => f === 'queries' ? null : 'queries')}
                  style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                    borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                    textAlign: 'left' }}
                >
                  ƒ Edit formula
                </button>
                <BindingIcon
                  isBound
                  onClick={() => setOpenField(f => f === 'queries' ? null : 'queries')}
                />
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>Queries</span>
                <BindingIcon
                  isBound={false}
                  onClick={() => setOpenField(f => f === 'queries' ? null : 'queries')}
                />
              </div>
        <button
          style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
                onClick={addQueryParam}
        >
          + Add
        </button>
      </div>
          )}
          {openField === 'queries' && (
            <FormulaEditor
              label="Queries"
              value={(cfg.queries as FormulaValue) ?? null}
              onChange={v => { setCfg('queries', v); setOpenField(null); }}
              onClose={() => setOpenField(null)}
              anchorRight={292}
            />
          )}
          {!isBoundValue(cfg.queries as FormulaValue) && queryParams.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {queryParams.map((qp, idx) => {
                const nameBound = isBoundValue(qp.name as FormulaValue);
                const valBound = isBoundValue(qp.value);
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {/* Name field */}
                      {nameBound ? (
                        <button
                          onClick={() => setOpenField(f => f === `query-name-${idx}` ? null : `query-name-${idx}`)}
                          style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                            borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                            textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          ƒ Edit formula
                        </button>
                      ) : (
          <input
            style={{ ...S.fieldInput, flex: 1 }}
                          placeholder="Name"
                          value={typeof qp.name === 'string' ? qp.name : ''}
                          onChange={e => setQueryParam(idx, { name: e.target.value })}
                        />
                      )}
                      <BindingIcon
                        isBound={nameBound}
                        onClick={() => setOpenField(f => f === `query-name-${idx}` ? null : `query-name-${idx}`)}
                      />
                      {/* Value field */}
                      {valBound ? (
                        <button
                          onClick={() => setOpenField(f => f === `query-${idx}` ? null : `query-${idx}`)}
                          style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                            borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                            textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          ƒ Edit formula
                        </button>
                      ) : (
                        <input
                          style={{ ...S.fieldInput, flex: 1 }}
                          placeholder="Value"
                          value={typeof qp.value === 'string' ? qp.value : ''}
                          onChange={e => setQueryParam(idx, { value: e.target.value as FormulaValue })}
                        />
                      )}
                      <BindingIcon
                        isBound={valBound}
                        onClick={() => setOpenField(f => f === `query-${idx}` ? null : `query-${idx}`)}
                      />
          <button
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0 }}
                        onClick={() => removeQueryParam(idx)}
          >
                        ×
          </button>
        </div>
                    {openField === `query-name-${idx}` && (
                      <FormulaEditor
                        label={`Query name ${idx + 1}`}
                        value={(qp.name as FormulaValue) ?? null}
                        onChange={v => { setQueryParam(idx, { name: v as string }); setOpenField(null); }}
                        onClose={() => setOpenField(null)}
                        anchorRight={292}
                      />
                    )}
                    {openField === `query-${idx}` && (
                      <FormulaEditor
                        label={`Query value: ${typeof qp.name === 'string' ? qp.name : String(idx)}`}
                        value={qp.value ?? null}
                        onChange={v => { setQueryParam(idx, { value: v as FormulaValue }); setOpenField(null); }}
                        onClose={() => setOpenField(null)}
                        anchorRight={292}
                      />
                    )}
    </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 8, borderTop: '1px solid #374151', paddingTop: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af' }}>Loader on page change</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>Show page loader</span>
              <CanvasOnOffToggle value={!!(cfg.showLoader)} onChange={v => setCfg('showLoader', v)} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── SetFormStateConfig ───────────────────────────────────────────────────────

function SetFormStateConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [openField, setOpenField] = useState<'isSubmitting' | 'isSubmitted' | null>(null);

  function renderBoolField(key: 'isSubmitting' | 'isSubmitted', label: string) {
    const val = cfg[key] as FormulaValue | boolean | undefined;
    const bound = isBoundValue(val as FormulaValue);
    return (
      <>
        <label style={{ ...S.fieldLabel, marginTop: 10 }}>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Bind icon on the LEFT, matching WeWeb reference */}
          <BindingIcon
            isBound={bound}
            onClick={() => setOpenField(f => f === key ? null : key)}
          />
          {bound ? (
            <button
              onClick={() => setOpenField(f => f === key ? null : key)}
              style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
                borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                textAlign: 'left' }}
            >ƒ Edit formula</button>
          ) : (
            <CanvasOnOffToggle value={!!val} onChange={v => setCfg(key, v)} />
          )}
        </div>
        {openField === key && (
          <FormulaEditor
            label={label}
            value={(val as FormulaValue) ?? null}
            onChange={v => { setCfg(key, v); setOpenField(null); }}
            onClose={() => setOpenField(null)}
            anchorRight={292}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div style={S.infoBox}>Set isSubmitting and isSubmitted</div>
      {renderBoolField('isSubmitting', 'isSubmitting')}
      {renderBoolField('isSubmitted', 'isSubmitted')}
    </>
  );
}

// ─── ResetFormConfig ──────────────────────────────────────────────────────────

function ResetFormConfig({
  cfg,
  setCfg,
}: {
  cfg: Record<string, unknown>;
  setCfg: (key: string, value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const val = cfg.initialValues as FormulaValue | string | undefined;
  const bound = isBoundValue(val as FormulaValue);

  return (
    <>
      <div style={S.infoBox}>Reset the form fields to their initial values</div>
      <label style={{ ...S.fieldLabel, marginTop: 10 }}>initialValues</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Bind icon on the LEFT, matching WeWeb reference */}
        <BindingIcon isBound={bound} onClick={() => setOpen(v => !v)} />
        {bound ? (
          <button
            onClick={() => setOpen(v => !v)}
            style={{ flex: 1, padding: '3px 8px', background: '#2e1065', border: '1px solid #7c3aed',
              borderRadius: 5, color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 500,
              textAlign: 'left' }}
          >ƒ Edit formula</button>
        ) : (
          <textarea
            style={{ ...S.fieldInput, flex: 1, minHeight: 72, fontFamily: 'monospace', fontSize: 11 }}
            placeholder={'{\n  "fieldName": "value"\n}'}
            value={typeof val === 'string' ? val : ''}
            onChange={e => setCfg('initialValues', e.target.value || undefined)}
          />
        )}
      </div>
      {open && (
        <FormulaEditor
          label="initialValues"
          value={(val as FormulaValue) ?? null}
          onChange={v => { setCfg('initialValues', v); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRight={292}
        />
      )}
    </>
  );
}

// ─── NodePropsPanel ────────────────────────────────────────────────────────────

function NodePropsPanel({
  step,
  onUpdate,
  isFormContext = false,
}: {
  step: ActionStep;
  onUpdate: (patch: Partial<ActionStep>) => void;
  isFormContext?: boolean;
}) {
  const cfg = step.config ?? {};

  function setCfg(key: string, value: unknown) {
    onUpdate({ config: { ...cfg, [key]: value } });
  }

  const isStructuralNode = isStructural(step.type);

  return (
    <div>
      <label style={S.fieldLabel}>Name</label>
      <input
        style={S.fieldInput}
        value={step.name ?? ''}
        placeholder="Action"
        onChange={e => onUpdate({ name: e.target.value })}
      />

      {/* Type dropdown — shown for action-type nodes, NOT for structural nodes, NOT for pass-through */}
      {!isStructuralNode && step.type !== 'passThroughCondition' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Type</label>
          <TypeSearchDropdown
            value={step.type}
            onChange={type => onUpdate({ type })}
            isFormContext={isFormContext}
          />
        </>
      )}

      {/* runProjectWorkflow: workflow picker using WorkflowBindButton */}
      {step.type === 'runProjectWorkflow' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Workflow *</label>
          <WorkflowBindButton
            value={(step.config?.workflowId as string) ?? step.action ?? ''}
            onChange={uuid => onUpdate({ action: uuid, config: { ...(step.config ?? {}), workflowId: uuid }, name: uuid })}
          />
        </>
      )}

      {/* Type-specific fields */}
      {step.type === 'branch' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition *</label>
          <textarea
            style={{ ...S.fieldInput, minHeight: 64, fontFamily: 'monospace', fontSize: 11 }}
            value={(cfg.condition as string) ?? ''}
            placeholder={'// evaluates to true or false\ntrue'}
            onChange={e => setCfg('condition', e.target.value)}
          />
        </>
      )}

      {step.type === 'multiOptionBranch' && (
        <>
          {/* Branches list */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb' }}>Branches</span>
            <button
              data-testid="branches-add-btn"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#fff', background: '#3b82f6', border: 'none', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}
              onClick={() => {
                const newBranch: BranchDef = { label: `Value ${(step.branches?.length ?? 0) + 1}`, steps: [{ id: `ph-${Date.now()}`, type: 'graphql' }] };
                onUpdate({ branches: [...(step.branches ?? []), newBranch] });
              }}
            >
              + Add
            </button>
          </div>
          {(step.branches ?? []).map((branch, bi) => (
            <div key={bi} style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {/* Line-number gutter */}
                <div style={{ minWidth: 20, fontSize: 11, color: '#6b7280', textAlign: 'right', flexShrink: 0 }}>
                  {bi + 1}
                </div>
                {/* Value input */}
                <input
                  data-testid={`branch-value-${bi}`}
                  style={{ ...S.fieldInput, flex: 1, color: '#e5e7eb' }}
                  value={branch.label}
                  onChange={e => {
                    const updated = (step.branches ?? []).map((b, i) => i === bi ? { ...b, label: e.target.value } : b);
                    onUpdate({ branches: updated });
                  }}
                />
                {/* Remove button — disabled when only 1 branch remains */}
                <button
                  data-testid={`branch-remove-${bi}`}
                  disabled={(step.branches?.length ?? 0) <= 1}
                  style={{ flexShrink: 0, background: '#fce7f3', border: 'none', borderRadius: '50%', width: 22, height: 22, color: '#db2777', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, cursor: (step.branches?.length ?? 0) <= 1 ? 'not-allowed' : 'pointer', opacity: (step.branches?.length ?? 0) <= 1 ? 0.35 : 1 }}
                  title="Remove branch"
                  onClick={() => {
                    const updated = (step.branches ?? []).filter((_, i) => i !== bi);
                    onUpdate({ branches: updated });
                  }}
                >
                  −
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {step.type === 'forEach' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Items to parse (array) *</label>
          <textarea
            style={{ ...S.fieldInput, minHeight: 64, fontFamily: 'monospace', fontSize: 11 }}
            value={(cfg.items as string) ?? ''}
            placeholder="[]"
            onChange={e => setCfg('items', e.target.value)}
          />
        </>
      )}

      {step.type === 'whileLoop' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition to check (boolean) *</label>
          <select style={S.fieldSelect} value={(cfg.condition as string) ?? 'false'}
            onChange={e => setCfg('condition', e.target.value)}>
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
          <div style={S.helpText}>
            The condition is evaluated before each iteration, if it is true, the actions inside the loop are executed. If the condition is false, the loop is exited, and the program continues with the next actions
          </div>
        </>
      )}

      {step.type === 'breakLoop' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition to check (boolean) *</label>
          <select style={S.fieldSelect} value={(cfg.condition as string) ?? 'false'}
            onChange={e => setCfg('condition', e.target.value)}>
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
          <div style={S.helpText}>
            This action needs to be inside a loop (Iterator for loop or while loop), the loop is immediately terminated, and the workflow jumps to the next action
          </div>
        </>
      )}

      {step.type === 'continueLoop' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition to check (boolean) *</label>
          <select style={S.fieldSelect} value={(cfg.condition as string) ?? 'false'}
            onChange={e => setCfg('condition', e.target.value)}>
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
          <div style={S.helpText}>
            This action needs to be inside a loop (Iterator for loop or while loop), the remaining actions in the loop, for the current iteration, are skipped. The workflow then proceeds to the next iteration of the loop, re-evaluating the loop condition
          </div>
        </>
      )}

      {step.type === 'passThroughCondition' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Condition *</label>
          <select style={S.fieldSelect} value={(cfg.condition as string) ?? 'true'}
            onChange={e => setCfg('condition', e.target.value)}>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </>
      )}

      {step.type === 'navigateTo' && (
        <NavigateToConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'navigatePrev' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Default Redirect Page</label>
          <select style={S.fieldSelect}>
            <option value="home">🏠 Home</option>
          </select>
        </>
      )}

      {step.type === 'pageLoader' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Loader on page change</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Show page loader</span>
            <div style={S.toggleGroup}>
              <button style={S.toggleBtn(!!(cfg.showLoader))} onClick={() => setCfg('showLoader', true)}>On</button>
              <button style={S.toggleBtn(!(cfg.showLoader))} onClick={() => setCfg('showLoader', false)}>Off</button>
            </div>
          </div>
          {cfg.showLoader && (
            <>
              <label style={{ ...S.fieldLabel, marginTop: 10 }}>Loader color</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={(cfg.loaderColor as string) ?? '#000000'} onChange={e => setCfg('loaderColor', e.target.value)} style={{ width: 28, height: 28, border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer' }} />
                <input style={{ ...S.fieldInput, flex: 1 }} value={(cfg.loaderColor as string) ?? '#000000'} onChange={e => setCfg('loaderColor', e.target.value)} />
              </div>
            </>
          )}
        </>
      )}

      {step.type === 'changeLanguage' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Language *</label>
          <select style={S.fieldSelect}><option value="">Select a value</option></select>
        </>
      )}

      {step.type === 'changeVariableValue' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Variable *</label>
          <select style={S.fieldSelect}><option value="">Choose a variable</option></select>
        </>
      )}

      {step.type === 'resetVariableValue' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Variables</span>
            <button style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <select style={{ ...S.fieldSelect, flex: 1 }}><option value="">Choose a variable</option></select>
            <button style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>−</button>
          </div>
        </>
      )}

      {step.type === 'fetchCollection' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Collection *</label>
          <select style={S.fieldSelect}><option value="">Choose a collection</option></select>
        </>
      )}

      {step.type === 'fetchCollectionsParallel' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Collections</span>
            <button style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>+ Add</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <select style={{ ...S.fieldSelect, flex: 1 }}><option value="">Choose a collection</option></select>
            <button style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>−</button>
          </div>
        </>
      )}

      {step.type === 'updateCollection' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Collection *</label>
          <select style={S.fieldSelect}><option value="">Choose an collection</option></select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Update type</label>
          <select style={S.fieldSelect}><option value="replaceAll">Replace all</option></select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Data *</label>
          <input style={S.fieldInput} placeholder="New collection data" />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Refresh filters</span>
            <div style={S.toggleGroup}>
              <button style={S.toggleBtn(!!(cfg.refreshFilters))} onClick={() => setCfg('refreshFilters', true)}>On</button>
              <button style={S.toggleBtn(!(cfg.refreshFilters))} onClick={() => setCfg('refreshFilters', false)}>Off</button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Refresh sort</span>
            <div style={S.toggleGroup}>
              <button style={S.toggleBtn(!!(cfg.refreshSort))} onClick={() => setCfg('refreshSort', true)}>On</button>
              <button style={S.toggleBtn(!(cfg.refreshSort))} onClick={() => setCfg('refreshSort', false)}>Off</button>
            </div>
          </div>
        </>
      )}

      {step.type === 'executeComponentAction' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Component</label>
          <select style={S.fieldSelect}><option value="">Component</option></select>
        </>
      )}

      {step.type === 'returnValue' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Type</label>
          <select style={S.fieldSelect} value={(cfg.valueType as string) ?? 'text'} onChange={e => setCfg('valueType', e.target.value)}>
            <option value="text">T Text</option>
            <option value="number">N Number</option>
            <option value="boolean">B Boolean</option>
            <option value="object">O Object</option>
            <option value="array">A Array</option>
          </select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Value *</label>
          <textarea style={{ ...S.fieldInput, minHeight: 56 }} placeholder="Enter a value" value={(cfg.value as string) ?? ''} onChange={e => setCfg('value', e.target.value)} />
        </>
      )}

      {step.type === 'timeDelay' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Time (ms) *</label>
          <input style={S.fieldInput} placeholder="Enter a value" type="number" value={(cfg.time as string) ?? ''} onChange={e => setCfg('time', e.target.value)} />
        </>
      )}

      {step.type === 'uploadFile' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Select upload element from this page *</label>
          <select style={S.fieldSelect}><option value="">Select an upload element</option></select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Tag for this file</label>
          <input style={S.fieldInput} placeholder="Enter a value" value={(cfg.tag as string) ?? ''} onChange={e => setCfg('tag', e.target.value)} />
        </>
      )}

      {step.type === 'stopPropagation' && (
        <div style={S.infoBox}>
          This action is executing Event.stopPropagation() and Event.preventDefault(). The recommended practice is to set this action as the first action of your workflow.
        </div>
      )}

      {step.type === 'copyToClipboard' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Value *</label>
          <textarea style={{ ...S.fieldInput, minHeight: 56 }} placeholder="Enter a value" value={(cfg.value as string) ?? ''} onChange={e => setCfg('value', e.target.value)} />
        </>
      )}

      {step.type === 'downloadFileFromUrl' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>File URL *</label>
          <input style={S.fieldInput} value={(cfg.url as string) ?? ''} onChange={e => setCfg('url', e.target.value)} />
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>File name</label>
          <input style={S.fieldInput} placeholder="Optional filename" value={(cfg.filename as string) ?? ''} onChange={e => setCfg('filename', e.target.value)} />
        </>
      )}

      {step.type === 'createUrlFromBase64' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Base64</label>
          <input style={S.fieldInput} placeholder="Enter a value" value={(cfg.base64 as string) ?? ''} onChange={e => setCfg('base64', e.target.value)} />
        </>
      )}

      {step.type === 'encodeFileAsBase64' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>File object *</label>
          <select style={S.fieldSelect}><option value="">Select a file variable</option></select>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Output format</label>
          <div style={S.toggleGroup}>
            <button style={S.toggleBtn((cfg.outputFormat as string) !== 'base64')} onClick={() => setCfg('outputFormat', 'dataUrl')}>Data URL</button>
            <button style={S.toggleBtn((cfg.outputFormat as string) === 'base64')} onClick={() => setCfg('outputFormat', 'base64')}>Base64</button>
          </div>
        </>
      )}

      {step.type === 'openPopup' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Popup model</label>
          <select style={S.fieldSelect}><option value="">Choose a popup model</option></select>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Wait close event</span>
            <div style={S.toggleGroup}>
              <button style={S.toggleBtn(!!(cfg.waitClose))} onClick={() => setCfg('waitClose', true)}>On</button>
              <button style={S.toggleBtn(!(cfg.waitClose))} onClick={() => setCfg('waitClose', false)}>Off</button>
            </div>
          </div>
        </>
      )}

      {step.type === 'closeAllPopups' && (
        <>
          <label style={{ ...S.fieldLabel, marginTop: 10 }}>Popup model</label>
          <select style={S.fieldSelect}><option value="">Choose a popup model</option></select>
        </>
      )}

      {step.type === 'setFormState' && (
        <SetFormStateConfig cfg={cfg} setCfg={setCfg} />
      )}

      {step.type === 'submitForm' && (
        <div style={S.infoBox}>Submit the form</div>
      )}

      {step.type === 'resetForm' && (
        <ResetFormConfig cfg={cfg} setCfg={setCfg} />
      )}

      <label style={{ ...S.fieldLabel, marginTop: 12 }}>Description</label>
      <textarea
        style={{ ...S.fieldInput, minHeight: 64, resize: 'vertical' }}
        value={step.description ?? ''}
        placeholder="Description…"
        onChange={e => onUpdate({ description: e.target.value })}
      />
    </div>
  );
}

// ─── Flow step tree helpers ───────────────────────────────────────────────────

function getStepAtPath(steps: ActionStep[], path: number[]): ActionStep | null {
  if (!path.length) return null;
  const [idx, ...rest] = path;
  const step = steps[idx];
  if (!step) return null;
  if (!rest.length) return step;
  // Navigate into children
  if (rest[0] === -1 && rest[1] !== undefined) {
    // -1 = trueBranch, -2 = falseBranch, -3 = loopBody, -4 = defaultBranch
    // We encode branch path as [parentIdx, branchCode, ...childPath]
    // branchCode: 0 = trueBranch, 1 = falseBranch, 2+ = branches[n-2], -1 = defaultBranch
    return null; // simplified — full deep navigation handled in FlowRenderer
  }
  return null;
}

function updateStepAtPath(
  steps: ActionStep[],
  path: number[],
  updater: (s: ActionStep) => ActionStep
): ActionStep[] {
  if (!path.length) return steps;
  const [idx, ...rest] = path;
  if (!rest.length) {
    return steps.map((s, i) => (i === idx ? updater(s) : s));
  }
  return steps.map((s, i) => {
    if (i !== idx) return s;
    // Recurse into sub-collections based on rest[0] being a string tag
    const [tag, ...subPath] = rest as [string, ...number[]];
    if (tag === 'true' && s.trueBranch) return { ...s, trueBranch: updateStepAtPath(s.trueBranch, subPath, updater) };
    if (tag === 'false' && s.falseBranch) return { ...s, falseBranch: updateStepAtPath(s.falseBranch, subPath, updater) };
    if (tag === 'loop' && s.loopBody) return { ...s, loopBody: updateStepAtPath(s.loopBody, subPath, updater) };
    if (tag === 'default' && s.defaultBranch) return { ...s, defaultBranch: updateStepAtPath(s.defaultBranch, subPath, updater) };
    if (tag?.startsWith('branch-') && s.branches) {
      const bIdx = parseInt(tag.split('-')[1], 10);
      return { ...s, branches: s.branches.map((b, bi) => bi === bIdx ? { ...b, steps: updateStepAtPath(b.steps, subPath, updater) } : b) };
    }
    return s;
  });
}

function insertStepAtPath(
  steps: ActionStep[],
  path: number[],
  newStep: ActionStep
): ActionStep[] {
  if (!path.length) return steps;
  if (path.length === 1) {
    const copy = [...steps];
    copy.splice(path[0], 0, newStep);
    return copy;
  }
  const [idx, tag, ...subPath] = path as [number, string, ...number[]];
  return steps.map((s, i) => {
    if (i !== idx) return s;
    if (tag === 'true' && s.trueBranch) return { ...s, trueBranch: insertStepAtPath(s.trueBranch, subPath, newStep) };
    if (tag === 'false' && s.falseBranch) return { ...s, falseBranch: insertStepAtPath(s.falseBranch, subPath, newStep) };
    if (tag === 'loop' && s.loopBody) return { ...s, loopBody: insertStepAtPath(s.loopBody, subPath, newStep) };
    if (tag === 'default' && s.defaultBranch) return { ...s, defaultBranch: insertStepAtPath(s.defaultBranch, subPath, newStep) };
    if (tag?.startsWith('branch-') && s.branches) {
      const bIdx = parseInt(tag.split('-')[1], 10);
      return { ...s, branches: s.branches.map((b, bi) => bi === bIdx ? { ...b, steps: insertStepAtPath(b.steps, subPath, newStep) } : b) };
    }
    return s;
  });
}

function removeStepAtPath(steps: ActionStep[], path: number[]): ActionStep[] {
  if (!path.length) return steps;
  if (path.length === 1) return steps.filter((_, i) => i !== path[0]);
  const [idx, tag, ...subPath] = path as [number, string, ...number[]];
  return steps.map((s, i) => {
    if (i !== idx) return s;
    if (tag === 'true' && s.trueBranch) return { ...s, trueBranch: removeStepAtPath(s.trueBranch, subPath) };
    if (tag === 'false' && s.falseBranch) return { ...s, falseBranch: removeStepAtPath(s.falseBranch, subPath) };
    if (tag === 'loop' && s.loopBody) return { ...s, loopBody: removeStepAtPath(s.loopBody, subPath) };
    if (tag === 'default' && s.defaultBranch) return { ...s, defaultBranch: removeStepAtPath(s.defaultBranch, subPath) };
    if (tag?.startsWith('branch-') && s.branches) {
      const bIdx = parseInt(tag.split('-')[1], 10);
      return { ...s, branches: s.branches.map((b, bi) => bi === bIdx ? { ...b, steps: removeStepAtPath(b.steps, subPath) } : b) };
    }
    return s;
  });
}

// ─── Connector component ──────────────────────────────────────────────────────

function Connector({ showArrow = true }: { showArrow?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={S.vLine} />
      {showArrow && <div style={S.arrowHead} />}
    </div>
  );
}

// ─── Insert button ────────────────────────────────────────────────────────────

function InsertButton({ onClick }: { onClick: (x: number, y: number) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={S.vLine} />
      <button
        data-testid="insert-btn"
        style={S.insertBtn(hovered)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={e => { e.stopPropagation(); onClick(e.clientX, e.clientY); }}
        title="Insert action here"
      >
        +
      </button>
      <div style={S.vLine} />
    </div>
  );
}

// ─── FlowRenderer — recursive ─────────────────────────────────────────────────

interface FlowRendererProps {
  steps: ActionStep[];
  pathPrefix: (string | number)[];
  selectedPath: (string | number)[] | null;
  copiedStep: ActionStep | null;
  onSelect: (path: (string | number)[]) => void;
  onInsert: (insertIdx: number, pathPrefix: (string | number)[], x: number, y: number) => void;
  onContextMenu: (e: React.MouseEvent, step: ActionStep, path: (string | number)[]) => void;
  onUpdateStep: (path: (string | number)[], patch: Partial<ActionStep>) => void;
}

function pathEquals(a: (string | number)[] | null, b: (string | number)[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function FlowRenderer({
  steps,
  pathPrefix,
  selectedPath,
  copiedStep,
  onSelect,
  onInsert,
  onContextMenu,
  onUpdateStep,
}: FlowRendererProps) {
  return (
    <div style={S.flowColumn}>
      {steps.length === 0 && (
        <InsertButton onClick={(x, y) => onInsert(0, pathPrefix, x, y)} />
      )}
      {steps.map((step, idx) => {
        const stepPath = [...pathPrefix, idx];
        const isSelected = pathEquals(selectedPath, stepPath);

        return (
          <React.Fragment key={step.id}>
            {/* Insert button before first item only if there are items */}
            {idx === 0 && steps.length > 0 && (
              <InsertButton onClick={(x, y) => onInsert(0, pathPrefix, x, y)} />
            )}

            {/* Render the step */}
            {(step.type === 'branch') && (
              <BranchNode step={step} stepPath={stepPath} isSelected={isSelected} selectedPath={selectedPath} copiedStep={copiedStep} onSelect={onSelect} onInsert={onInsert} onContextMenu={onContextMenu} onUpdateStep={onUpdateStep} />
            )}
            {(step.type === 'multiOptionBranch') && (
              <MultiOptionBranchNode step={step} stepPath={stepPath} isSelected={isSelected} selectedPath={selectedPath} copiedStep={copiedStep} onSelect={onSelect} onInsert={onInsert} onContextMenu={onContextMenu} onUpdateStep={onUpdateStep} />
            )}
            {(step.type === 'forEach' || step.type === 'whileLoop') && (
              <LoopNode step={step} stepPath={stepPath} isSelected={isSelected} selectedPath={selectedPath} copiedStep={copiedStep} onSelect={onSelect} onInsert={onInsert} onContextMenu={onContextMenu} onUpdateStep={onUpdateStep} />
            )}
            {(step.type === 'passThroughCondition') && (
              <PassThroughNode step={step} stepPath={stepPath} isSelected={isSelected} onSelect={onSelect} onContextMenu={onContextMenu} />
            )}
            {!['branch', 'multiOptionBranch', 'forEach', 'whileLoop', 'passThroughCondition'].includes(step.type) && (
              <ActionNode step={step} stepPath={stepPath} isSelected={isSelected} onSelect={onSelect} onContextMenu={onContextMenu} />
            )}

            {/* Insert button after each step */}
            <InsertButton onClick={(x, y) => onInsert(idx + 1, pathPrefix, x, y)} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Action card node ─────────────────────────────────────────────────────────

function ActionNode({
  step,
  stepPath,
  isSelected,
  onSelect,
  onContextMenu,
}: {
  step: ActionStep;
  stepPath: (string | number)[];
  isSelected: boolean;
  onSelect: (path: (string | number)[]) => void;
  onContextMenu: (e: React.MouseEvent, step: ActionStep, path: (string | number)[]) => void;
}) {
  const incomplete = !isConfigured(step);
  const testable = canTest(step);
  const label = incomplete ? 'Action' : getActionLabel(step.type);
  const icon = incomplete ? '⚡' : getActionIcon(step.type);
  const subtextLabel = incomplete ? 'Click to configure' : (
    step.type === 'runProjectWorkflow' && (step.config?.workflowId || step.action) ? String(step.config?.workflowId ?? step.action) :
    step.type === 'timeDelay' && step.config?.time ? `${step.config.time}ms` : undefined
  );

  return (
    <div
      data-testid={`action-node-${step.id}`}
      style={S.card(isSelected, incomplete)}
      onClick={() => onSelect(stepPath)}
    >
      <div style={S.cardTopRow}>
        <span style={S.cardIcon}>{icon}</span>
        <span style={S.cardName}>{step.name || label}</span>
        {/* Test button — hidden until runtime testing is supported */}
        {/* <button style={S.testBtn(!testable)} onClick={e => e.stopPropagation()} disabled={!testable} title="Test action">Test ▷</button> */}
        <button
          data-testid="context-menu-btn"
          style={S.moreBtn}
          type="button"
          onPointerDown={e => { e.stopPropagation(); onContextMenu(e as unknown as React.MouseEvent, step, stepPath); }}
          onClick={e => e.stopPropagation()}
          title="More options"
        >
          ⋮
        </button>
      </div>
      {(subtextLabel || incomplete) && (
        <div style={S.cardSubtext(incomplete)}>
          {subtextLabel ?? (incomplete ? 'Click to configure' : '')}
        </div>
      )}
    </div>
  );
}

// ─── Pass through condition (oval shape) ─────────────────────────────────────

function PassThroughNode({
  step,
  stepPath,
  isSelected,
  onSelect,
  onContextMenu,
}: {
  step: ActionStep;
  stepPath: (string | number)[];
  isSelected: boolean;
  onSelect: (path: (string | number)[]) => void;
  onContextMenu: (e: React.MouseEvent, step: ActionStep, path: (string | number)[]) => void;
}) {
  return (
    <div
      style={{ ...S.pillNode(isSelected, true), gap: 8 }}
      onClick={() => onSelect(stepPath)}
    >
      <span style={{ fontSize: 12 }}>▽</span>
      <span>{step.name || 'Pass through condition'}</span>
      <button
        style={{ ...S.moreBtn, fontSize: 14 }}
        type="button"
        onPointerDown={e => { e.stopPropagation(); onContextMenu(e as unknown as React.MouseEvent, step, stepPath); }}
        onClick={e => e.stopPropagation()}
      >
        ⋮
      </button>
    </div>
  );
}

// ─── True/False branch node ───────────────────────────────────────────────────

function BranchNode({
  step, stepPath, isSelected, selectedPath, copiedStep,
  onSelect, onInsert, onContextMenu, onUpdateStep,
}: {
  step: ActionStep; stepPath: (string | number)[]; isSelected: boolean;
  selectedPath: (string | number)[] | null; copiedStep: ActionStep | null;
  onSelect: (p: (string | number)[]) => void;
  onInsert: (idx: number, prefix: (string | number)[], x: number, y: number) => void;
  onContextMenu: (e: React.MouseEvent, s: ActionStep, p: (string | number)[]) => void;
  onUpdateStep: (p: (string | number)[], patch: Partial<ActionStep>) => void;
}) {
  const trueBranch = step.trueBranch ?? [];
  const falseBranch = step.falseBranch ?? [];
  const BRANCH_W = 280;
  const GAP = 64;
  const totalW = BRANCH_W * 2 + GAP;
  // Fallback constants (used until DOM is measured)
  const fallbackXCenters = [BRANCH_W / 2, totalW - BRANCH_W / 2];

  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<{ xCenters: number[]; heights: number[]; rowW: number }>({
    xCenters: fallbackXCenters,
    heights: [0, 0],
    rowW: totalW,
  });

  useEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      if (!row) return;
      const xCenters = colRefs.current.map(el =>
        el ? (el.offsetLeft - row.offsetLeft) + el.offsetWidth / 2 : 0
      );
      const heights = colRefs.current.map(el => el?.offsetHeight ?? 0);
      setLayout({ xCenters, heights, rowW: row.offsetWidth });
    };

    const observers: ResizeObserver[] = [];
    const targets = [rowRef.current, ...colRefs.current].filter(Boolean) as HTMLDivElement[];
    targets.forEach(el => {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.push(ro);
    });
    measure();

    return () => observers.forEach(ro => ro.disconnect());
  }, []);

  const rowW = layout.rowW || totalW;
  const xL = layout.xCenters[0] ?? fallbackXCenters[0];
  const xR = layout.xCenters[1] ?? fallbackXCenters[1];
  const maxH = layout.heights.length ? Math.max(...layout.heights) : 0;

  return (
    <div data-testid={`action-node-${step.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Pill header */}
      <div
        style={S.pillNode(isSelected)}
        onClick={() => onSelect(stepPath)}
      >
        <span>⟐</span>
        <span>{step.name || 'True/False split'}</span>
        <button style={S.moreBtn} type="button" onPointerDown={e => { e.stopPropagation(); onContextMenu(e as unknown as React.MouseEvent, step, stepPath); }} onClick={e => e.stopPropagation()}>⋮</button>
      </div>
      {/* Top split SVG: center drop → horizontal bar → per-column drops */}
      <svg width={rowW} height={32} style={{ flexShrink: 0, overflow: 'visible' }}>
        <line x1={rowW / 2} y1={0} x2={rowW / 2} y2={16} stroke="#4b5563" strokeWidth={1} />
        <line x1={xL} y1={16} x2={xR} y2={16} stroke="#4b5563" strokeWidth={1} />
        <line x1={xL} y1={16} x2={xL} y2={32} stroke="#4b5563" strokeWidth={1} />
        <line x1={xR} y1={16} x2={xR} y2={32} stroke="#4b5563" strokeWidth={1} />
      </svg>
      {/* Branch columns */}
      <div ref={rowRef} style={{ display: 'flex', alignItems: 'flex-start', gap: GAP }}>
        {/* True */}
        <div
          ref={el => { colRefs.current[0] = el; }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: BRANCH_W }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: '#34d399', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 20, padding: '2px 10px', marginBottom: 6 }}>true</span>
          <FlowRenderer
            steps={trueBranch}
            pathPrefix={[...stepPath, 'true']}
            selectedPath={selectedPath}
            copiedStep={copiedStep}
            onSelect={onSelect}
            onInsert={onInsert}
            onContextMenu={onContextMenu}
            onUpdateStep={onUpdateStep}
          />
        </div>
        {/* False */}
        <div
          ref={el => { colRefs.current[1] = el; }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: BRANCH_W }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 20, padding: '2px 10px', marginBottom: 6 }}>false</span>
          <FlowRenderer
            steps={falseBranch}
            pathPrefix={[...stepPath, 'false']}
            selectedPath={selectedPath}
            copiedStep={copiedStep}
            onSelect={onSelect}
            onInsert={onInsert}
            onContextMenu={onContextMenu}
            onUpdateStep={onUpdateStep}
          />
        </div>
      </div>
      {/* Rejoin SVG: vertical drops from each column center, single bottom merge bar, center drop */}
      <svg width={rowW} height={36} style={{ flexShrink: 0, overflow: 'visible' }}>
        <line x1={xL} y1={-(maxH - (layout.heights[0] ?? 0))} x2={xL} y2={24} stroke="#4b5563" strokeWidth={1} />
        <line x1={xR} y1={-(maxH - (layout.heights[1] ?? 0))} x2={xR} y2={24} stroke="#4b5563" strokeWidth={1} />
        <line x1={xL} y1={24} x2={xR} y2={24} stroke="#4b5563" strokeWidth={1} />
        <line x1={rowW / 2} y1={24} x2={rowW / 2} y2={36} stroke="#4b5563" strokeWidth={1} />
      </svg>
      <Connector />
    </div>
  );
}

// ─── Multi-option branch node ─────────────────────────────────────────────────

function MultiOptionBranchNode({
  step, stepPath, isSelected, selectedPath, copiedStep,
  onSelect, onInsert, onContextMenu, onUpdateStep,
}: {
  step: ActionStep; stepPath: (string | number)[]; isSelected: boolean;
  selectedPath: (string | number)[] | null; copiedStep: ActionStep | null;
  onSelect: (p: (string | number)[]) => void;
  onInsert: (idx: number, prefix: (string | number)[], x: number, y: number) => void;
  onContextMenu: (e: React.MouseEvent, s: ActionStep, p: (string | number)[]) => void;
  onUpdateStep: (p: (string | number)[], patch: Partial<ActionStep>) => void;
}) {
  const branches = step.branches ?? [
    { label: 'First value', steps: [] },
    { label: 'Second value', steps: [] },
    { label: 'Third value', steps: [] },
  ];
  const defaultBranch = step.defaultBranch;
  const allBranches = defaultBranch !== undefined ? [...branches, { label: 'default', steps: defaultBranch }] : branches;
  const BRANCH_W = 260;
  const GAP = 48;
  const totalW = allBranches.length * BRANCH_W + (allBranches.length - 1) * GAP;
  // Fallback constants (used until DOM is measured)
  const fallbackXCenters = allBranches.map((_, bi) => bi * (BRANCH_W + GAP) + BRANCH_W / 2);

  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<{ xCenters: number[]; heights: number[]; rowW: number }>({
    xCenters: fallbackXCenters,
    heights: new Array(allBranches.length).fill(0),
    rowW: totalW,
  });

  useEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      if (!row) return;
      const xCenters = colRefs.current.slice(0, allBranches.length).map(el =>
        el ? (el.offsetLeft - row.offsetLeft) + el.offsetWidth / 2 : 0
      );
      const heights = colRefs.current.slice(0, allBranches.length).map(el => el?.offsetHeight ?? 0);
      setLayout({ xCenters, heights, rowW: row.offsetWidth });
    };

    const observers: ResizeObserver[] = [];
    const targets = [rowRef.current, ...colRefs.current.slice(0, allBranches.length)].filter(Boolean) as HTMLDivElement[];
    targets.forEach(el => {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      observers.push(ro);
    });
    measure();

    return () => observers.forEach(ro => ro.disconnect());
  }, [allBranches.length]);

  const rowW = layout.rowW || totalW;
  const xCenters = layout.xCenters.length === allBranches.length ? layout.xCenters : fallbackXCenters;
  const maxH = layout.heights.length ? Math.max(...layout.heights) : 0;

  return (
    <div data-testid={`action-node-${step.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={S.pillNode(isSelected)} onClick={() => onSelect(stepPath)}>
        <span>⟐</span>
        <span>{step.name || 'Multi-option split'}</span>
        <button style={S.moreBtn} type="button" onPointerDown={e => { e.stopPropagation(); onContextMenu(e as unknown as React.MouseEvent, step, stepPath); }} onClick={e => e.stopPropagation()}>⋮</button>
      </div>
      {/* Top split SVG: center drop → horizontal bar → per-column drops */}
      <svg width={rowW} height={32} style={{ flexShrink: 0, overflow: 'visible' }}>
        <line x1={rowW / 2} y1={0} x2={rowW / 2} y2={16} stroke="#4b5563" strokeWidth={1} />
        <line x1={xCenters[0]} y1={16} x2={xCenters[xCenters.length - 1]} y2={16} stroke="#4b5563" strokeWidth={1} />
        {xCenters.map((cx, bi) => (
          <line key={bi} x1={cx} y1={16} x2={cx} y2={32} stroke="#4b5563" strokeWidth={1} />
        ))}
      </svg>
      <div ref={rowRef} style={{ display: 'flex', alignItems: 'flex-start', gap: GAP }}>
        {allBranches.map((branch, bi) => {
          const branchKey = bi < branches.length ? `branch-${bi}` : 'default';
          return (
            <div
              key={bi}
              ref={el => { colRefs.current[bi] = el; }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: BRANCH_W }}
            >
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 20,
                padding: '2px 10px',
                marginBottom: 6,
                ...(bi >= branches.length
                  ? { color: '#9ca3af', background: 'rgba(107,114,128,0.12)', border: '1px solid rgba(107,114,128,0.3)' }
                  : { color: '#a5b4fc', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(165,180,252,0.3)' }),
              }}>
                {branch.label}
              </span>
              <FlowRenderer
                steps={branch.steps}
                pathPrefix={[...stepPath, branchKey]}
                selectedPath={selectedPath}
                copiedStep={copiedStep}
                onSelect={onSelect}
                onInsert={onInsert}
                onContextMenu={onContextMenu}
                onUpdateStep={onUpdateStep}
              />
            </div>
          );
        })}
      </div>
      {/* Rejoin SVG: vertical drops from each column center, single bottom merge bar, center drop */}
      <svg width={rowW} height={36} style={{ flexShrink: 0, overflow: 'visible' }}>
        {xCenters.map((cx, bi) => {
          const drop = layout.heights[bi] != null ? maxH - layout.heights[bi] : 0;
          return <line key={bi} x1={cx} y1={-drop} x2={cx} y2={24} stroke="#4b5563" strokeWidth={1} />;
        })}
        <line x1={xCenters[0]} y1={24} x2={xCenters[xCenters.length - 1]} y2={24} stroke="#4b5563" strokeWidth={1} />
        <line x1={rowW / 2} y1={24} x2={rowW / 2} y2={36} stroke="#4b5563" strokeWidth={1} />
      </svg>
      <Connector />
    </div>
  );
}

// ─── Loop node (Iterator / While) ─────────────────────────────────────────────

function LoopNode({
  step, stepPath, isSelected, selectedPath, copiedStep,
  onSelect, onInsert, onContextMenu, onUpdateStep,
}: {
  step: ActionStep; stepPath: (string | number)[]; isSelected: boolean;
  selectedPath: (string | number)[] | null; copiedStep: ActionStep | null;
  onSelect: (p: (string | number)[]) => void;
  onInsert: (idx: number, prefix: (string | number)[], x: number, y: number) => void;
  onContextMenu: (e: React.MouseEvent, s: ActionStep, p: (string | number)[]) => void;
  onUpdateStep: (p: (string | number)[], patch: Partial<ActionStep>) => void;
}) {
  const loopBody = step.loopBody ?? [];
  const icon = step.type === 'whileLoop' ? '∞' : '↻';
  const label = step.type === 'whileLoop' ? 'While loop' : 'Iterator (for loop)';

  const pillRowRef = useRef<HTMLDivElement | null>(null);
  const [pillRowH, setPillRowH] = useState(34);

  useEffect(() => {
    const el = pillRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPillRowH(el.offsetHeight));
    ro.observe(el);
    setPillRowH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  return (
    <div data-testid={`action-node-${step.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Loop pill with play button to the left */}
      <div ref={pillRowRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Arrowhead pointing right at the top-left junction — indicates loop-back direction */}
        <div style={{
          width: 0,
          height: 0,
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          borderLeft: '8px solid rgb(55, 65, 81)',
          zIndex: 1,
        }} />
        <div style={S.pillNode(isSelected)} onClick={() => onSelect(stepPath)}>
          <span>{icon}</span>
          <span>{step.name || label}</span>
          <button style={S.moreBtn} type="button" onPointerDown={e => { e.stopPropagation(); onContextMenu(e as unknown as React.MouseEvent, step, stepPath); }} onClick={e => e.stopPropagation()}>⋮</button>
        </div>
      </div>
      {/* Loop body row: left back-arrow | right dashed container */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch' }}>
        {/* Dashed loop body container */}
        <div data-testid="loop-body-container" style={S.loopContainer}>
          <div style={{
           position: 'absolute',
           inset: `-${Math.round(pillRowH / 2)}px 50% 14px 0px`,
           borderLeft: '1px dashed rgb(55, 65, 81)',
           borderTop: '1px dashed rgb(55, 65, 81)',
           borderBottom: '1px dashed rgb(55, 65, 81)',
           zIndex: -1,
          }} />
          <FlowRenderer
            steps={loopBody}
            pathPrefix={[...stepPath, 'loop']}
            selectedPath={selectedPath}
            copiedStep={copiedStep}
            onSelect={onSelect}
            onInsert={onInsert}
            onContextMenu={onContextMenu}
            onUpdateStep={onUpdateStep}
          />
          <div style={S.endLoopLabel}>End Loop</div>
        </div>
      </div>
      <Connector />
    </div>
  );
}

// ─── Main WorkflowCanvas component ───────────────────────────────────────────

// ─── WorkflowOptionsMenu ──────────────────────────────────────────────────────

function WorkflowOptionsMenu({
  target,
  anchorRect,
  onClose,
  onDelete,
}: {
  target: WorkflowCanvasTarget;
  anchorRect: DOMRect;
  onClose: () => void;
  onDelete: () => void;
}) {
  const canDelete = target.kind === 'pageWorkflow' || target.kind === 'globalWorkflow';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Only close when clicking OUTSIDE the menu
      if (!(e.target as HTMLElement).closest('[data-testid="workflow-options-menu"]')) onClose();
    };
    // Use bubble phase (not capture) so menu button clicks inside fire first
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 14px', fontSize: 12, cursor: 'pointer',
    background: 'transparent', border: 'none', color: '#e5e7eb',
    width: '100%', textAlign: 'left',
  };

  return (
    <div
      data-testid="workflow-options-menu"
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        right: window.innerWidth - anchorRect.right,
        top: anchorRect.bottom + 4,
        zIndex: 10001,
        background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)', minWidth: 160, overflow: 'hidden',
      }}
    >
      {canDelete && (
        <button
          style={{ ...itemStyle, color: '#f87171' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#450a0a'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          onClick={() => onDelete()}
        >
          Delete workflow
        </button>
      )}
    </div>
  );
}

export interface WorkflowCanvasProps {
  target: WorkflowCanvasTarget;
  onClose: () => void;
}

export function WorkflowCanvas({ target, onClose }: WorkflowCanvasProps) {
  const store = useBuilderStore();

  // ── Local state ─────────────────────────────────────────────────────────────
  const [steps, setSteps] = useState<ActionStep[]>([]);
  const [onErrorSteps, setOnErrorSteps] = useState<ActionStep[]>([]);
  const [activeTab, setActiveTab] = useState<'default' | 'onError'>('default');
  const [selectedPath, setSelectedPath] = useState<(string | number)[] | null>(null);
  const [zoomDisplay, setZoomDisplay] = useState(1);
  const zoomRef = useRef(1);
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [triggerValue, setTriggerValue] = useState<string>('click');
  const [triggerDropdownOpen, setTriggerDropdownOpen] = useState(false);
  const [addPopoverState, setAddPopoverState] = useState<{ insertIdx: number; pathPrefix: (string | number)[]; x: number; y: number } | null>(null);
  const [copiedStep, setCopiedStep] = useState<ActionStep | null>(null);
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);
  const [workflowMeta, setWorkflowMeta] = useState<WorkflowMeta>({ id: '', name: 'Workflow' });
  const [workflowMenuAnchor, setWorkflowMenuAnchor] = useState<DOMRect | null>(null);
  const workflowMenuBtnRef = useRef<HTMLButtonElement>(null);

  // ── History (undo/redo) ───────────────────────────────────────────────────────
  const historyRef = useRef<{ steps: ActionStep[]; onErrorSteps: ActionStep[] }[]>([]);
  const historyIdxRef = useRef(-1);
  // Keep live refs so undo/redo always sees current values without stale closures
  const stepsRef = useRef(steps);
  const onErrorStepsRef = useRef(onErrorSteps);
  stepsRef.current = steps;
  onErrorStepsRef.current = onErrorSteps;

  const currentSteps = activeTab === 'default' ? steps : onErrorSteps;
  const setCurrentSteps = activeTab === 'default' ? setSteps : setOnErrorSteps;

  // ── Init ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let initialSteps: ActionStep[] = [];
    if (target.kind === 'element') {
      const node = findNode(store.pageNodes, target.nodeId);
      const nodeType = node?.type as string | undefined;
      const cats = getTriggerCategories(nodeType);
      const firstTrigger = cats[0]?.options[0]?.value ?? 'click';
      setTriggerValue(target.event || firstTrigger);
      const nodeActions = node?.actions;
      const dam = store.directActionsMap;
      // New array format: each item is a workflow ref; trigger is owned by the workflow definition
      if (Array.isArray(nodeActions)) {
        initialSteps = (nodeActions as unknown[]).map((raw, i) => deserializeStep(raw, `loaded-${i}-${Date.now()}`, dam));
      } else {
        // Legacy event-keyed object format
        const existing = (nodeActions as Record<string, unknown> | undefined)?.[target.event];
      const rawArr: unknown[] = Array.isArray(existing) ? existing : existing ? [existing] : [];
      initialSteps = rawArr.map((raw, i) => deserializeStep(raw, `loaded-${i}-${Date.now()}`, dam));
      }
      setSteps(initialSteps);
    } else if (target.kind === 'globalWorkflow') {
      const meta = store.globalWorkflowMeta[target.id];
      setWorkflowMeta(meta ?? { id: target.id, name: 'Workflow' });
      const rawGlobal = (store.globalWorkflows[target.id] ?? []) as unknown[];
      initialSteps = rawGlobal.map((raw, i) => deserializeStep(raw, `loaded-${i}-${Date.now()}`, store.directActionsMap));
      setSteps(initialSteps);
    } else if (target.kind === 'pageWorkflow') {
      const meta = store.pageWorkflowMeta?.[target.name];
      setWorkflowMeta({ id: target.name, name: target.name, ...meta });
      setTriggerValue(meta?.trigger ?? 'click');
      const rawPage = (store.pageWorkflows[target.name] ?? []) as unknown[];
      initialSteps = rawPage.map((raw, i) => deserializeStep(raw, `loaded-${i}-${Date.now()}`, store.directActionsMap));
      setSteps(initialSteps);
    }
    // Seed history with the initial state so undo never goes past it
    historyRef.current = [{ steps: initialSteps, onErrorSteps: [] }];
    historyIdxRef.current = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save & close ─────────────────────────────────────────────────────────────
  function handleClose() {
    if (target.kind === 'element') {
      // Serialize steps back to array format — trigger is owned by each named workflow definition
      const nodeId = target.nodeId;
      const serialized = steps.map(serializeStep);
      store.patchNodeField(nodeId, 'actions', serialized.length > 0 ? serialized : undefined);
    } else if (target.kind === 'globalWorkflow') {
      store.setGlobalWorkflow(target.id, steps as object[]);
      store.setGlobalWorkflowMeta(target.id, workflowMeta);
    } else if (target.kind === 'pageWorkflow') {
      store.setPageWorkflow(target.name, steps as object[]);
      store.setPageWorkflowMeta(target.name, { ...workflowMeta, trigger: triggerValue });
    }
    onClose();
  }

  // ── Trigger info ─────────────────────────────────────────────────────────────
  const targetNodeType = (() => {
    if (target.kind === 'element') return findNode(store.pageNodes, target.nodeId)?.type as string | undefined;
    if (target.kind === 'pageWorkflow' && target.nodeId) return findNode(store.pageNodes, target.nodeId)?.type as string | undefined;
    return undefined;
  })();
  // pageWorkflow and element both have an editable trigger; globalWorkflow/pageTrigger are fixed
  const isFixedTrigger = target.kind !== 'element' && target.kind !== 'pageWorkflow';
  const triggerLabel = isFixedTrigger ? 'On execution' : getTriggerLabel(triggerValue, targetNodeType);
  // Form context: show form-specific action types when the source element is inside (or is) a FormContainer
  const isFormContext = (() => {
    if (target.kind === 'element') {
      // Check if the element itself is a FormContainer or is inside one
      const node = findNode(store.pageNodes, target.nodeId);
      return (node?.type as string) === 'FormContainer' || hasFormContainerAncestor(store.pageNodes, target.nodeId);
    }
    if (target.kind === 'pageWorkflow' && target.nodeId) {
      const node = findNode(store.pageNodes, target.nodeId);
      return (node?.type as string) === 'FormContainer' || hasFormContainerAncestor(store.pageNodes, target.nodeId);
    }
    return false;
  })();

  // ── History helpers ───────────────────────────────────────────────────────────
  // Push the NEW state (after a mutation) so undo/redo both read the correct snapshot.
  function pushHistory(newCurrentSteps: ActionStep[]) {
    const snapshot = {
      steps: activeTab === 'default' ? newCurrentSteps : stepsRef.current,
      onErrorSteps: activeTab === 'onError' ? newCurrentSteps : onErrorStepsRef.current,
    };
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(snapshot);
    historyIdxRef.current = historyRef.current.length - 1;
  }

  function undo() {
    // idx=0 means we're already at the initial snapshot — nothing to undo
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    const snapshot = historyRef.current[historyIdxRef.current];
    setSteps(snapshot.steps);
    setOnErrorSteps(snapshot.onErrorSteps);
    setSelectedPath(null);
  }

  function redo() {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    const snapshot = historyRef.current[historyIdxRef.current];
    setSteps(snapshot.steps);
    setOnErrorSteps(snapshot.onErrorSteps);
    setSelectedPath(null);
  }

  // ── Step mutations ────────────────────────────────────────────────────────────
  function addStep(type: ActionStepType, insertIdx: number, pathPrefix: (string | number)[]) {
    const newStep: ActionStep = {
      id: generateId(),
      type,
      trueBranch: type === 'branch' ? [createPlaceholderStep()] : undefined,
      falseBranch: type === 'branch' ? [createPlaceholderStep()] : undefined,
      branches: type === 'multiOptionBranch' ? [
        { label: 'First value', steps: [createPlaceholderStep()] },
        { label: 'Second value', steps: [createPlaceholderStep()] },
        { label: 'Third value', steps: [createPlaceholderStep()] },
      ] : undefined,
      loopBody: (type === 'forEach' || type === 'whileLoop') ? [createPlaceholderStep()] : undefined,
    };
    const cur = activeTab === 'default' ? stepsRef.current : onErrorStepsRef.current;
    const next = pathPrefix.length === 0
      ? (() => { const c = [...cur]; c.splice(insertIdx, 0, newStep); return c; })()
      : insertStepAtPath(cur, [...pathPrefix, insertIdx] as number[], newStep);
    setCurrentSteps(next);
    pushHistory(next);
    setSelectedPath([...pathPrefix, insertIdx]);
  }

  function pasteStep(insertIdx: number, pathPrefix: (string | number)[]) {
    if (!copiedStep) return;
    const pasted: ActionStep = { ...copiedStep, id: generateId() };
    const cur = activeTab === 'default' ? stepsRef.current : onErrorStepsRef.current;
    const next = pathPrefix.length === 0
      ? (() => { const c = [...cur]; c.splice(insertIdx, 0, pasted); return c; })()
      : insertStepAtPath(cur, [...pathPrefix, insertIdx] as number[], pasted);
    setCurrentSteps(next);
    pushHistory(next);
    setSelectedPath([...pathPrefix, insertIdx]);
  }

  function updateSelectedStep(patch: Partial<ActionStep>) {
    if (!selectedPath) return;
    const cur = activeTab === 'default' ? stepsRef.current : onErrorStepsRef.current;
    const next = updateStepAtPath(cur, selectedPath as number[], s => ({ ...s, ...patch }));
    setCurrentSteps(next);
    pushHistory(next);
  }

  function deleteStep(path: (string | number)[]) {
    const cur = activeTab === 'default' ? stepsRef.current : onErrorStepsRef.current;
    const next = removeStepAtPath(cur, path as number[]);
    setCurrentSteps(next);
    pushHistory(next);
    if (pathEquals(selectedPath, path)) setSelectedPath(null);
  }

  function duplicateStep(path: (string | number)[]) {
    const step = getStepFromPath(currentSteps, path);
    if (!step) return;
    const dup: ActionStep = { ...step, id: generateId() };
    const parentPath = path.slice(0, -1);
    const idx = path[path.length - 1] as number;
    const cur = activeTab === 'default' ? stepsRef.current : onErrorStepsRef.current;
    const next = parentPath.length === 0
      ? (() => { const c = [...cur]; c.splice(idx + 1, 0, dup); return c; })()
      : insertStepAtPath(cur, [...parentPath, idx + 1] as number[], dup);
    setCurrentSteps(next);
    pushHistory(next);
  }

  function toggleDisableStep(path: (string | number)[]) {
    const cur = activeTab === 'default' ? stepsRef.current : onErrorStepsRef.current;
    const next = updateStepAtPath(cur, path as number[], s => ({ ...s, disabled: !s.disabled }));
    setCurrentSteps(next);
    pushHistory(next);
  }

  function getStepFromPath(steps: ActionStep[], path: (string | number)[]): ActionStep | null {
    if (!path.length) return null;
    const [idx, ...rest] = path;
    const step = steps[idx as number];
    if (!step) return null;
    if (!rest.length) return step;
    const [tag, ...subPath] = rest as [string, ...number[]];
    if (tag === 'true' && step.trueBranch) return getStepFromPath(step.trueBranch, subPath);
    if (tag === 'false' && step.falseBranch) return getStepFromPath(step.falseBranch, subPath);
    if (tag === 'loop' && step.loopBody) return getStepFromPath(step.loopBody, subPath);
    if (tag === 'default' && step.defaultBranch) return getStepFromPath(step.defaultBranch, subPath);
    if (tag?.startsWith('branch-') && step.branches) {
      const bIdx = parseInt(tag.split('-')[1], 10);
      return getStepFromPath(step.branches[bIdx]?.steps ?? [], subPath);
    }
    return null;
  }

  const selectedStep = selectedPath ? getStepFromPath(currentSteps, selectedPath) : null;

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { handleClose(); return; }
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod) {
        // Undo
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        // Redo
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
        // Paste
        if (e.key === 'v' && copiedStep) {
          e.preventDefault();
          if (selectedPath) {
            const idx = (selectedPath[selectedPath.length - 1] as number) + 1;
            pasteStep(idx, selectedPath.slice(0, -1) as (string | number)[]);
          } else {
            pasteStep(currentSteps.length, []);
          }
          return;
        }
        if (selectedStep && selectedPath) {
          if (e.key === 'c') { e.preventDefault(); setCopiedStep({ ...selectedStep }); }
          if (e.key === 'd') { e.preventDefault(); duplicateStep(selectedPath); }
        }
      }
      if (e.key === 'Delete' && selectedPath) {
        deleteStep(selectedPath);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStep, selectedPath, copiedStep, currentSteps]);

  // ── Zoom / pan ────────────────────────────────────────────────────────────────
  function applyTransform(px: number, py: number, z: number) {
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(calc(-50% + ${px}px), ${py}px) scale(${z})`;
    }
  }

  function adjustZoom(delta: number) {
    const newZoom = Math.max(0.3, Math.min(2.5, Math.round((zoomRef.current + delta) * 10) / 10));
    zoomRef.current = newZoom;
    applyTransform(panXRef.current, panYRef.current, newZoom);
    setZoomDisplay(newZoom);
  }

  function resetZoom() {
    zoomRef.current = 1;
    panXRef.current = 0;
    panYRef.current = 0;
    applyTransform(0, 0, 1);
    setZoomDisplay(1);
  }

  // Wheel: Ctrl/Meta = zoom centred on cursor, plain = pan
  useEffect(() => {
    const canvas = canvasAreaRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      // Let native scroll work when pointer is inside a popover/dropdown
      if ((e.target as HTMLElement).closest('[data-popover]')) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2; // relative to world origin
        const cy = e.clientY - rect.top;
        const delta = -e.deltaY * 0.005;
        const oldZoom = zoomRef.current;
        const newZoom = Math.max(0.3, Math.min(2.5, oldZoom * (1 + delta * 3)));
        const scale = newZoom / oldZoom;
        panXRef.current = cx * (1 - scale) + panXRef.current * scale;
        panYRef.current = cy * (1 - scale) + panYRef.current * scale;
        zoomRef.current = newZoom;
      } else {
        panXRef.current -= e.deltaX;
        panYRef.current -= e.deltaY;
      }
      applyTransform(panXRef.current, panYRef.current, zoomRef.current);
      setZoomDisplay(Math.round(zoomRef.current * 100) / 100);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div data-testid="workflow-canvas" style={S.overlay} onClick={() => { setTriggerDropdownOpen(false); setAddPopoverState(null); setContextMenuState(null); }}>
      {/* Top bar */}
      <div style={S.topBar} onClick={e => e.stopPropagation()}>
        {/* Left: workflow name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {target.kind === 'globalWorkflow' || target.kind === 'pageWorkflow' ? toHumanName(workflowMeta.name) : 'Workflow'}
          </span>
        </div>
        {/* Center: Default / On error tabs */}
        <div style={{ display: 'flex', background: '#1f2937', borderRadius: 24, padding: 2 }}>
          <button data-testid="workflow-tab-default" style={S.tabPill(activeTab === 'default')} onClick={() => setActiveTab('default')}>Default</button>
          <button data-testid="workflow-tab-onerror" style={S.tabPill(activeTab === 'onError')} onClick={() => setActiveTab('onError')}>On error</button>
        </div>
        {/* Right: Close */}
        <button data-testid="workflow-canvas-close" style={S.closeBtn} onClick={handleClose}>
          <span style={{ fontSize: 14 }}>×</span> Close
        </button>
      </div>

      {/* Content area */}
      <div style={S.contentArea}>
        {/* Canvas */}
        <div ref={canvasAreaRef} style={S.canvasArea} onClick={() => setSelectedPath(null)}>
          {/* Figma-style dot grid */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.18 }}>
            <defs>
              <pattern id="wf-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.8" fill="#6b7280" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#wf-grid)" />
          </svg>
          {/* World container — transform applied directly for smooth wheel zoom/pan */}
          <div
            ref={worldRef}
            style={{ position: 'absolute', left: '50%', top: 40, transformOrigin: '0 0', transform: 'translate(-50%, 0px) scale(1)', willChange: 'transform' }}
          >
            <div style={S.flowColumn} onClick={e => e.stopPropagation()}>
              {/* Trigger pill */}
              <div style={{ position: 'relative' }}>
                <div
                  data-testid="workflow-trigger-pill"
                  style={S.triggerPill(!isFixedTrigger)}
                  onClick={() => !isFixedTrigger && setTriggerDropdownOpen(v => !v)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', color: '#fbbf24', flexShrink: 0 }}>
                    {isFixedTrigger ? <TI.Zap /> : getTriggerIcon(triggerValue)}
                  </span>
                  <span>{triggerLabel}</span>
                  {!isFixedTrigger && <span style={{ fontSize: 10, color: '#9ca3af' }}>▾</span>}
                </div>
                {triggerDropdownOpen && !isFixedTrigger && (
                  <TriggerDropdown
                    value={triggerValue}
                    nodeType={targetNodeType}
                    onChange={v => setTriggerValue(v)}
                    onClose={() => setTriggerDropdownOpen(false)}
                  />
                )}
              </div>

              {/* Main flow */}
              <Connector />
              <FlowRenderer
                steps={currentSteps}
                pathPrefix={[]}
                selectedPath={selectedPath}
                copiedStep={copiedStep}
                onSelect={p => setSelectedPath(p)}
                onInsert={(insertIdx, pathPrefix, x, y) => setAddPopoverState({ insertIdx, pathPrefix, x, y })}
                onContextMenu={(e, step, path) => {
                  e.stopPropagation();
                  setContextMenuState({ x: e.clientX, y: e.clientY, step, path });
                }}
                onUpdateStep={(path, patch) => {
                  setCurrentSteps(prev => updateStepAtPath(prev, path as number[], s => ({ ...s, ...patch })));
                }}
              />

              {/* Add action text link at the bottom */}
              {currentSteps.length > 0 && (
                <button
                  data-testid="add-action-link"
                  style={S.addActionLink}
                  onClick={e => { e.stopPropagation(); setAddPopoverState({ insertIdx: currentSteps.length, pathPrefix: [], x: e.clientX, y: e.clientY }); }}
                >
                  + Add an action
                </button>
              )}

            </div>
          </div>
        </div>

        {/* Right properties panel */}
        <div style={S.rightPanel} onClick={e => e.stopPropagation()}>
          {/* Panel header */}
          <div style={S.rightPanelHeader}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb', flex: 1 }}>Workflow</span>
            {/* Workflow options menu */}
            <button
              ref={workflowMenuBtnRef}
              data-testid="workflow-panel-menu-btn"
              style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1, borderRadius: 4 }}
              onClick={e => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                setWorkflowMenuAnchor(prev => prev ? null : rect);
              }}
              title="Workflow options"
            >⋮</button>
            {workflowMenuAnchor && (
              <WorkflowOptionsMenu
                target={target}
                anchorRect={workflowMenuAnchor}
                onClose={() => setWorkflowMenuAnchor(null)}
                onDelete={() => {
                  setWorkflowMenuAnchor(null);
                  if (target.kind === 'pageWorkflow') {
                    // Remove from the node's actions array so the right panel no longer lists it
                    if (target.nodeId) {
                      // Use findNode (recursive tree search) — pageNodes is a tree, not a flat array
                      const node = findNode(store.pageNodes, target.nodeId);
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const currentActions: any[] = Array.isArray((node as any)?.actions)
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ? (node as any).actions
                        : [];
                      if (currentActions.length > 0) {
                        const updated = currentActions.filter(
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          (a: any) => a?.action !== target.name
                        );
                        store.patchNodeField(target.nodeId, 'actions', updated.length > 0 ? updated : undefined);
                      }
                    }
                    store.removePageWorkflow(target.name);
                  } else if (target.kind === 'globalWorkflow') {
                    store.removeGlobalWorkflow(target.id);
                  }
                  onClose();
                }}
              />
            )}
          </div>

          {/* Panel body */}
          <div data-testid="workflow-props-panel" style={S.rightPanelBody}>
            {selectedStep ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #1f2937' }}>
                  <span style={{ fontSize: 14 }}>{getActionIcon(selectedStep.type)}</span>
                  <span>{selectedStep.name || getActionLabel(selectedStep.type)}</span>
                </div>
                <NodePropsPanel
                  step={selectedStep}
                  onUpdate={patch => updateSelectedStep(patch)}
                  isFormContext={isFormContext}
                />
              </>
            ) : (target.kind === 'globalWorkflow' || target.kind === 'pageWorkflow') ? (
              <WorkflowMetaPanel
                meta={workflowMeta}
                onChange={patch => setWorkflowMeta(prev => ({ ...prev, ...patch }))}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: 24, gap: 8 }}>
                <span style={{ fontSize: 32, opacity: 0.3 }}>⚡</span>
                <span style={{ fontWeight: 600, color: '#6b7280' }}>Select an action</span>
                <span>Click any action node to configure it</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Zoom controls */}
      <div style={S.bottomBar}>
        <button data-testid="workflow-zoom-in" style={S.zoomBtn} onClick={() => adjustZoom(0.1)} title="Zoom in">+</button>
        <button data-testid="workflow-zoom-out" style={S.zoomBtn} onClick={() => adjustZoom(-0.1)} title="Zoom out">−</button>
        <button data-testid="workflow-zoom-reset" style={{ ...S.zoomBtn, fontSize: 11, width: 'auto', padding: '0 8px' }} onClick={resetZoom} title="Reset zoom">
          {Math.round(zoomDisplay * 100)}%
        </button>
      </div>

      {/* Insert action popover — rendered outside canvas transform so position:fixed works correctly */}
      {addPopoverState && (
        <div
          style={{
            position: 'fixed',
            top: addPopoverState.y + 8 + 420 > window.innerHeight
              ? Math.max(8, addPopoverState.y - 420 - 8)
              : addPopoverState.y + 8,
            left: Math.min(addPopoverState.x + 8, window.innerWidth - 280),
            zIndex: 200,
          }}
          onClick={e => e.stopPropagation()}
        >
          <AddActionPopover
            copiedStep={copiedStep}
            onSelect={type => { addStep(type, addPopoverState.insertIdx, addPopoverState.pathPrefix); setAddPopoverState(null); }}
            onPaste={() => { pasteStep(addPopoverState.insertIdx, addPopoverState.pathPrefix); setAddPopoverState(null); }}
            onClose={() => setAddPopoverState(null)}
            isFormContext={isFormContext}
          />
        </div>
      )}

      {/* Context menu */}
      {contextMenuState && (
        <ContextMenuPopup
          state={contextMenuState}
          copiedStep={copiedStep}
          onClose={() => setContextMenuState(null)}
          onDisable={() => toggleDisableStep(contextMenuState.path)}
          onCopy={() => setCopiedStep({ ...contextMenuState.step })}
          onPaste={() => {
            const idx = (contextMenuState.path[contextMenuState.path.length - 1] as number) + 1;
            const prefix = contextMenuState.path.slice(0, -1);
            pasteStep(idx, prefix);
          }}
          onDuplicate={() => duplicateStep(contextMenuState.path)}
          onDelete={() => deleteStep(contextMenuState.path)}
        />
      )}
    </div>
  );
}
