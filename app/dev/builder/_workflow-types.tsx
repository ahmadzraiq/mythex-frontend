'use client';

/**
 * _workflow-types.tsx
 *
 * Pure types, constants, and utility functions for the workflow canvas.
 * Extracted from _workflow-canvas.tsx to reduce its size and allow other files
 * to import types without pulling in the full canvas implementation.
 *
 * What lives here:
 *  - ActionStepType union, BranchDef, ActionStep interfaces
 *  - Trigger definitions (ELEMENT_TRIGGERS, UNIVERSAL_TRIGGER_CATEGORIES, getTriggerCategories)
 *  - Trigger icon atoms (TI) and getTriggerIcon
 *  - ActionTypeDef, ACTION_CATEGORIES, FORM_ACTION_CATEGORY
 *  - Step serialization helpers: deserializeStep, serializeStep
 *  - Step query helpers: getActionDef, getActionLabel, getActionIcon, isStructural, isConfigured, canTest
 *  - ID generation: generateId, createPlaceholderStep
 */

import React from 'react';

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
  // Form (shown only when inside a FormContainer)
  | 'submitForm'
  | 'setFormState'
  | 'resetForm'
  // Actions category
  | 'changeVariableValue'
  | 'fetchCollection'
  | 'fetchCollectionsParallel'
  | 'updateCollection'
  | 'resetVariableValue'
  | 'executeComponentAction'
  | 'emitComponentTrigger'

  | 'returnValue'
  | 'timeDelay'
  | 'pickFile'
  // Advanced
  | 'stopPropagation'
  | 'printPdf'
  | 'copyToClipboard'
  | 'downloadFileFromUrl'
  | 'createUrlFromBase64'
  | 'encodeFileAsBase64'
  | 'scrollToElement'
  // Unified animation control (Phase 9 — replaces 5 separate types below)
  | 'controlAnimation'
  // Legacy animation types — kept for backward compat; engine aliases to controlAnimation
  | 'animate'
  | 'triggerExitAnimation'
  | 'startLoop'
  | 'stopLoop'
  | 'playEnterAnimation'
  // Unified shared component management (Phase 9 — replaces 3 separate types below)
  | 'modifySharedComponent'
  // Legacy SC types — kept for backward compat
  | 'addSharedComponent'
  | 'deleteSharedComponent'
  | 'deleteAllSharedComponents'
  // Unified popover control (Phase 9 — replaces 3 separate types below)
  | 'controlPopover'
  // Legacy popover types — kept for backward compat
  | 'openPopover'
  | 'closePopover'
  | 'togglePopover'
  // Data / API
  | 'graphql'
  | 'fetchData'
  // Project workflows
  | 'runProjectWorkflow'
  // Code
  | 'runJavaScript'
  // ── Backend (server-context) actions ─────────────────────────────
  | 'runApiEndpoint'       // Call a published API Endpoint from client
  | 'tablesInsert'         // Server: insert row(s)
  | 'tablesGet'            // Server: get row by id
  | 'tablesList'           // Server: list rows
  | 'tablesUpdate'         // Server: update row
  | 'tablesDelete'         // Server: delete row
  | 'sendEmailAction'      // Server: send email
  | 'serverJavaScript'     // Server: run server-side JS (isolated-vm)
  // ── New server-context actions ────────────────────────────────────
  | 'sendResponse'         // Server: send HTTP response
  | 'sendStreamingResponse'// Server: send SSE streaming response
  | 'middlewareNext'       // Server: pass to next middleware/handler
  | 'workflowResult'       // Server: return value from a FUNCTION workflow
  | 'runServerFunction'    // Server: call a FUNCTION-kind workflow
  | 'executeSQL'           // Server: execute raw SQL
  | 'runFormula'           // Server: evaluate a formula expression
  | 'throwError'           // Server: throw an error
  | 'tryCatch'             // Server: try/catch structural block
  | 'createWorkflowVariable' // Server: declare a workflow-scoped variable
  | 'hashPassword'         // Server: bcrypt hash a password
  | 'verifyPassword'       // Server: compare password against bcrypt hash
  | 'generateToken'        // Server: sign a JWT
  | 'verifyToken'          // Server: verify a JWT
  // Placeholder — new step not yet configured
  | 'unconfigured';

export interface BranchDef {
  match: string;
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
   * points to a direct action (graphql, fetch, navigateTo, etc.), this field stores the original
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
  // tryCatch branches
  tryBody?: ActionStep[];
  catchBody?: ActionStep[];
  finallyBody?: ActionStep[];
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

export type { TriggerCategory };

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
    category: 'Drag',
    options: [
      { value: 'dragStart',  label: 'On drag start' },
      { value: 'dragUpdate', label: 'On drag update' },
      { value: 'dragEnd',    label: 'On drag end' },
    ],
  },
  {
    category: 'Other',
    options: [
      { value: 'scroll',     label: 'On scroll' },
      { value: 'escapeKey',  label: 'On Escape key' },
      { value: 'resize',     label: 'On page resize' },
      { value: 'keydown',    label: 'On keydown' },
      { value: 'keyup',      label: 'On keyup' },
    ],
  },
  {
    category: 'Lifecycle',
    options: [
      { value: 'created',         label: 'On created' },
      { value: 'mounted',         label: 'On mounted' },
      { value: 'beforeUnmount',   label: 'Before unmount' },
      { value: 'appLoadBefore',   label: 'On app load (before fetching collections)' },
      { value: 'appLoad',         label: 'On app load' },
      { value: 'pageLoadBefore',  label: 'On page load (before fetching collections)' },
      { value: 'pageLoad',        label: 'On page load' },
      { value: 'pageUnload',      label: 'On page unload' },
    ],
  },
  {
    category: 'Error handling',
    options: [
      { value: 'collectionFetchError', label: 'On collection fetch error' },
    ],
  },
];

/**
 * Restricted trigger categories shown in the canvas trigger dropdown when
 * the workflow was created from the Triggers tab (isTrigger: true).
 * Matches exactly the options shown in the weWeb-style trigger picker.
 */
/** Trigger categories available only when editing a component-scoped workflow. */
export const COMPONENT_TRIGGER_CATEGORIES: TriggerCategory[] = [
  {
    category: 'Component lifecycle',
    options: [
      { value: 'execution',      label: 'On execution' },
      { value: 'created',        label: 'On created' },
      { value: 'mounted',        label: 'On mounted' },
      { value: 'beforeUnmount',  label: 'Before unmount' },
      { value: 'propertyChange', label: 'On property change' },
    ],
  },
];

export const TRIGGER_WORKFLOW_CATEGORIES: TriggerCategory[] = [
  {
    category: 'Lifecycle',
    options: [
      { value: 'appLoadBefore',  label: 'On app load (before fetching collections)' },
      { value: 'pageLoadBefore', label: 'On page load (before fetching collections)' },
      { value: 'appLoad',        label: 'On app load' },
      { value: 'pageLoad',       label: 'On page load' },
      { value: 'pageUnload',     label: 'On page unload' },
    ],
  },
  {
    category: 'Listeners',
    options: [
      { value: 'scroll',  label: 'On page scroll' },
      { value: 'resize',  label: 'On page resize' },
      { value: 'keydown', label: 'On keydown' },
      { value: 'keyup',   label: 'On keyup' },
    ],
  },
  {
    category: 'Error handling',
    options: [
      { value: 'collectionFetchError', label: 'On collection fetch error' },
    ],
  },
];

/**
 * A custom component event declared on an SC model. Passed into the trigger
 * picker so listener workflows on an instance can bind to the event by id
 * and render a friendly label.
 */
export interface CustomTriggerOption {
  id: string;
  name: string;
}

export function getTriggerCategories(
  nodeType?: string,
  customTriggers?: readonly CustomTriggerOption[],
): TriggerCategory[] {
  const elementOptions = nodeType ? (ELEMENT_TRIGGERS[nodeType] ?? []) : [];
  const cats: TriggerCategory[] = [];
  if (elementOptions.length) {
    cats.push({ category: 'Element triggers', options: elementOptions });
  }
  if (customTriggers && customTriggers.length) {
    cats.push({
      category: 'Component events',
      options: customTriggers.map(t => ({ value: t.id, label: t.name })),
    });
  }
  return [...cats, ...UNIVERSAL_TRIGGER_CATEGORIES];
}

export function getTriggerLabel(
  value: string,
  nodeType?: string,
  customTriggers?: readonly CustomTriggerOption[],
): string {
  const all = getTriggerCategories(nodeType, customTriggers).flatMap(c => c.options);
  return all.find(o => o.value === value)?.label ?? value;
}

// Inline SVG icon atoms — 14×14, inherits currentColor
export const TI = {
  Click: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 9l11 2.5-4 1.5 1.5 4L9 9z"/>
      <path d="M7 2v2M2 7h2M4.22 4.22l1.42 1.42"/>
    </svg>
  ),
  Circle: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9"/>
    </svg>
  ),
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
  Zap: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Rotate: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
    </svg>
  ),
  Server: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2"/>
      <rect x="2" y="14" width="20" height="8" rx="2"/>
      <line x1="6" y1="6" x2="6.01" y2="6"/>
      <line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
  ),
  Edit: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  Eye: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  Enter: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 10 4 15 9 20"/>
      <path d="M20 4v7a4 4 0 0 1-4 4H4"/>
    </svg>
  ),
  Move: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5 9 2 12 5 15"/>
      <polyline points="9 5 12 2 15 5"/>
      <polyline points="15 19 12 22 9 19"/>
      <polyline points="19 9 22 12 19 15"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <line x1="12" y1="2" x2="12" y2="22"/>
    </svg>
  ),
};

export function getTriggerIcon(value: string): React.ReactNode {
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
    case 'escapeKey':
    case 'appLoadBefore':
    case 'appLoad':
    case 'pageLoadBefore':
    case 'pageLoad':
    case 'pageUnload':
    case 'keydown':
    case 'keyup':
      return <TI.Zap />;
    case 'mounted':
      return <TI.Rotate />;
    case 'beforeUnmount':
    case 'collectionFetchError':
      return <TI.Server />;
    case 'resize':
      return <TI.Circle />;
    case 'change':
    case 'initValueChange':
    case 'valueChange':
      return <TI.Edit />;
    case 'focus':
    case 'blur':
      return <TI.Eye />;
    case 'enterKey':
      return <TI.Enter />;
    case 'dragStart':
    case 'dragUpdate':
    case 'dragEnd':
      return <TI.Move />;
    default:
      return <TI.Zap />;
  }
}

// ─── Action type definitions ──────────────────────────────────────────────────

export interface ActionTypeDef {
  type: ActionStepType;
  label: string;
  icon: string;
  isStructural?: boolean;
  description?: string;
  /** 'client' = only in page workflows, 'server' = only in backend workflows, undefined = both */
  context?: 'client' | 'server';
}

export const ACTION_CATEGORIES: { category: string; context?: 'client' | 'server'; items: ActionTypeDef[] }[] = [
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
      { type: 'passThroughCondition', label: 'Pass through condition', icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg>' },
    ],
  },
  {
    category: 'Navigation',
    context: 'client',
    items: [
      { type: 'navigateTo', label: 'Navigate to', icon: '🔗' },
      { type: 'navigatePrev', label: 'Navigate to previous page', icon: '↩' },
    ],
  },
  {
    category: 'Actions',
    items: [
      // runProjectWorkflow is NOT listed here — it appears dynamically as "Project workflows"
      { type: 'changeVariableValue', label: 'Change variable value', icon: '⇄', context: 'client' },
      { type: 'fetchCollection', label: 'Fetch collection(s)', icon: '🗄', context: 'client' },
      // fetchCollectionsParallel kept for backward compat — use fetchCollection with collectionIds array
      { type: 'updateCollection', label: 'Update collection', icon: '🗄', context: 'client' },
      { type: 'resetVariableValue', label: 'Reset variable value', icon: '⇄', context: 'client' },
      { type: 'executeComponentAction', label: 'Execute component action', icon: '⚡', context: 'client' },
      { type: 'emitComponentTrigger', label: 'Emit component trigger', icon: '⚡', context: 'client' },

      { type: 'returnValue', label: 'Return a value', icon: '⚡' },
      { type: 'timeDelay', label: 'Time delay', icon: '⏱' },
      { type: 'pickFile', label: 'Pick file', icon: '⬆', context: 'client' },
    ],
  },
  // "Project workflows" is injected dynamically in AddActionPopover (not a fixed category)
  {
    category: 'Code',
    items: [
      { type: 'runJavaScript', label: 'JavaScript', icon: '</>' },
    ],
  },
  {
    category: 'GraphQL',
    items: [
      { type: 'graphql', label: 'GraphQL Request', icon: '⬡' },
    ],
  },
  {
    category: 'REST API',
    items: [
      { type: 'fetchData', label: 'REST API Request', icon: '⬡' },
    ],
  },
  {
    category: 'Advanced actions',
    context: 'client',
    items: [
      { type: 'stopPropagation', label: 'Stop click propagation', icon: '🖱' },
      { type: 'printPdf', label: 'Print PDF', icon: '🖨' },
      { type: 'copyToClipboard', label: 'Copy to clipboard', icon: '📋' },
      { type: 'downloadFileFromUrl', label: 'Download file from URL', icon: '</>' },
      { type: 'createUrlFromBase64', label: 'Create URL from Base64', icon: '</>' },
      { type: 'encodeFileAsBase64', label: 'Encode file as Base64', icon: '</>' },
      { type: 'scrollToElement',    label: 'Scroll to element',    icon: '↓' },
      { type: 'controlAnimation',   label: 'Control animation',    icon: '✨' },
    ],
  },
  {
    category: 'Shared Component',
    context: 'client',
    items: [
      { type: 'modifySharedComponent', label: 'Modify shared component', icon: '⧉' },
    ],
  },
  {
    category: 'Popover',
    context: 'client',
    items: [
      { type: 'controlPopover', label: 'Control popover', icon: '◱' },
    ],
  },
  // ── Backend / Data & API (client-side calls to server endpoints) ──────────
  {
    category: 'Backend',
    context: 'client',
    items: [
      { type: 'runApiEndpoint', label: 'Run API Endpoint', icon: '⟶', description: 'Call a published server API Endpoint and bind its output to variables.' },
    ],
  },
  // ── Server-side actions (only available in server workflow context) ────────
  {
    category: 'Tables',
    context: 'server',
    items: [
      { type: 'tablesList',   label: 'List rows',    icon: '⊞' },
      { type: 'tablesGet',    label: 'Get row',      icon: '⊡' },
      { type: 'tablesInsert', label: 'Insert row',   icon: '+' },
      { type: 'tablesUpdate', label: 'Update row',   icon: '✎' },
      { type: 'tablesDelete', label: 'Delete row',   icon: '✕' },
    ],
  },
  {
    category: 'Server Email',
    context: 'server',
    items: [
      { type: 'sendEmailAction', label: 'Send email', icon: '✉' },
    ],
  },
  {
    category: 'Server Code',
    context: 'server',
    items: [
      { type: 'serverJavaScript', label: 'Server JavaScript', icon: '</>' },
    ],
  },
];

// ─── Server action categories (WeWeb-style) ──────────────────────────────────

type ServerWorkflowKind = 'API_ENDPOINT' | 'FUNCTION' | 'MIDDLEWARE';

/** Returns the action palette categories for server workflows, parameterized by workflow kind. */
export function getServerActionCategories(kind: ServerWorkflowKind): { category: string; items: ActionTypeDef[] }[] {
  // Flow (Logic) terminating actions differ by kind
  const terminators: ActionTypeDef[] = kind === 'FUNCTION'
    ? [{ type: 'workflowResult',  label: 'Workflow result',          icon: '⚡' }]
    : kind === 'MIDDLEWARE'
      ? [
          { type: 'middlewareNext',       label: 'Next',                    icon: '→' },
          { type: 'sendResponse',         label: 'Send Response',           icon: '⬆' },
          { type: 'sendStreamingResponse',label: 'Send Streaming Response', icon: '⇈' },
        ]
      : /* API_ENDPOINT */ [
          { type: 'sendResponse',         label: 'Send Response',           icon: '⬆' },
          { type: 'sendStreamingResponse',label: 'Send Streaming Response', icon: '⇈' },
        ];

  const flowLogic: ActionTypeDef[] = [
    ...terminators,
    { type: 'passThroughCondition',    label: 'Pass through condition',    icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg>' },
    { type: 'branch',                  label: 'True/False split',          icon: '⟐', isStructural: true },
    { type: 'multiOptionBranch',       label: 'Multi-option split',        icon: '⟐', isStructural: true },
    { type: 'tryCatch',                label: 'Try/Catch',                 icon: '⚡', isStructural: true },
    { type: 'forEach',                 label: 'Iterator (for loop)',        icon: '↻', isStructural: true },
    { type: 'whileLoop',               label: 'While loop',                icon: '∞', isStructural: true },
    { type: 'breakLoop',               label: 'Break loop',                icon: '⊙' },
    { type: 'continueLoop',            label: 'Continue loop',             icon: '→' },
    { type: 'throwError',              label: 'Throw error',               icon: '⚠' },
    { type: 'createWorkflowVariable',  label: 'Create workflow variable',  icon: '(x)' },
    { type: 'changeVariableValue',     label: 'Change variable value',     icon: '⇄' },
    { type: 'resetVariableValue',      label: 'Reset variable value',      icon: '↺' },
    { type: 'timeDelay',               label: 'Time delay',                icon: '⏱' },
  ];

  return [
    { category: 'Flow (Logic)', items: flowLogic },
    { category: 'Tables', items: [
      { type: 'tablesList',   label: 'Get rows',    icon: '⊞' },
      { type: 'tablesInsert', label: 'Insert rows', icon: '⊞' },
      { type: 'tablesUpdate', label: 'Update rows', icon: '⊞' },
      { type: 'tablesDelete', label: 'Delete rows', icon: '⊞' },
      { type: 'executeSQL',   label: 'Execute SQL', icon: '⊞' },
    ]},
    { category: 'Auth', items: [
      { type: 'hashPassword',   label: 'Hash password',    icon: '🔒' },
      { type: 'verifyPassword', label: 'Verify password',  icon: '🔓' },
      { type: 'generateToken',  label: 'Generate token',   icon: '🔑' },
      { type: 'verifyToken',    label: 'Verify token',     icon: '🛡' },
    ]},
    { category: 'Functions', items: [
      { type: 'runFormula', label: 'Run formula', icon: 'ƒ' },
      // runServerFunction items are injected dynamically (like runProjectWorkflow)
    ]},
    { category: 'Advanced', items: [
      { type: 'serverJavaScript', label: 'Custom JavaScript', icon: 'JS' },
    ]},
    { category: 'HTTP Request', items: [
      { type: 'fetchData', label: 'HTTP Request', icon: '⬡' },
    ]},
  ];
}

// Form-specific actions — injected into TypeSearchDropdown only when inside a FormContainer
export const FORM_ACTION_CATEGORY: { category: string; items: ActionTypeDef[] } = {
  category: 'Other',
  items: [
    { type: 'submitForm',   label: 'Submit form',   icon: '⊡' },
    { type: 'setFormState', label: 'Set form state', icon: '⊟' },
    { type: 'resetForm',    label: 'Reset form',    icon: '⊟' },
  ],
};

/** Step types that appear in the builder Type dropdown. Only these execute at runtime. */
export const SUPPORTED_WORKFLOW_STEP_TYPES = new Set<ActionStepType>([
  ...ACTION_CATEGORIES.flatMap((c) => c.items.map((i) => i.type)),
  ...FORM_ACTION_CATEGORY.items.map((i) => i.type),
  'runProjectWorkflow',
]);

// ─── Step serialization ───────────────────────────────────────────────────────

/** Deserialize an array of raw steps, preserving existing ids when present. */
export function deserializeStepArray(arr: unknown[], dam?: Record<string, Record<string, unknown>>): ActionStep[] {
  return arr.map((raw, i) => {
    const obj = raw as Record<string, unknown>;
    const existingId = typeof obj?.id === 'string' ? obj.id : `step-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    return deserializeStep(raw, existingId, dam);
  });
}

/** Convert a raw JSON action value (from node.actions array) to a canvas ActionStep. */
export function deserializeStep(raw: unknown, id: string, directActionsMap?: Record<string, Record<string, unknown>>): ActionStep {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') return { id, type: 'unconfigured' };
  // ActionRef: { "action": "uuid" } — a step that calls another action by ID.
  // Look up the referenced action in directActionsMap first so a graphql/fetch/navigate
  // action shows as its real type instead of always appearing as "Call workflow".
  if (typeof obj.action === 'string' && !obj.type) {
    const refDef = directActionsMap?.[obj.action as string];
    if (refDef) {
      const isWorkflow = Array.isArray(refDef.steps);
      if (!isWorkflow && refDef.type) {
        // Direct action (graphql, fetch, navigateTo, etc.) — inline so the canvas
        // displays and lets the user edit its real configuration.
        const { type, name: refName, id: _refId, ...refConfig } = refDef;
        return {
          id,
          type: type as ActionStepType,
          name: (refName as string | undefined) ?? (obj.action as string),
          _actionRef: obj.action as string,
          config: refConfig,
        };
      }
      // Workflow reference — unwrap the single inner step so the canvas shows
      // the real action type (e.g. "Navigate to") rather than "Run project workflow".
      const innerSteps = refDef.steps as unknown[] | undefined;
      if (Array.isArray(innerSteps) && innerSteps.length === 1) {
        const innerRaw = innerSteps[0] as Record<string, unknown>;
        const { id: _innerId, name: _innerName, ...innerRest } = innerRaw;
        return {
          id,
          _actionRef: obj.action as string,
          ...(innerRest as Omit<ActionStep, 'id' | '_actionRef'>),
          name: (refDef.name as string | undefined) ?? (obj.action as string),
        };
      }
      // Multi-step workflow — use workflow name for display
      return {
        id,
        type: 'runProjectWorkflow',
        action: obj.action as string,
        config: { workflowId: obj.action as string },
        name: (refDef.name as string | undefined) ?? (obj.action as string),
        _actionRef: obj.action as string,
      };
    }
    // Unknown reference — fall back to runProjectWorkflow
    return { id, type: 'runProjectWorkflow', action: obj.action as string, config: { workflowId: obj.action as string }, name: obj.action as string };
  }
  // Already a typed step — cast as-is, but recursively deserialize structural children
  // so branch/loop steps inside trueBranch/falseBranch etc. are also properly resolved.
  const step: ActionStep = { id, ...(obj as Omit<ActionStep, 'id'>) };
  if (Array.isArray(obj.trueBranch)) step.trueBranch = deserializeStepArray(obj.trueBranch, directActionsMap);
  if (Array.isArray(obj.falseBranch)) step.falseBranch = deserializeStepArray(obj.falseBranch, directActionsMap);
  if (Array.isArray(obj.loopBody)) step.loopBody = deserializeStepArray(obj.loopBody, directActionsMap);
  if (Array.isArray(obj.defaultBranch)) step.defaultBranch = deserializeStepArray(obj.defaultBranch, directActionsMap);
  if (Array.isArray(obj.tryBody)) step.tryBody = deserializeStepArray(obj.tryBody, directActionsMap);
  if (Array.isArray(obj.catchBody)) step.catchBody = deserializeStepArray(obj.catchBody, directActionsMap);
  if (Array.isArray(obj.finallyBody)) step.finallyBody = deserializeStepArray(obj.finallyBody, directActionsMap);
  if (Array.isArray(obj.branches)) {
    step.branches = (obj.branches as Array<{ match?: string; label?: string; steps: unknown[] }>).map(b => ({
      match: b.match ?? b.label ?? '',
      steps: deserializeStepArray(b.steps ?? [], directActionsMap),
    }));
  }
  return step;
}

/** Convert canvas ActionStep back to raw JSON for storage on the node. */
export function serializeStep(step: ActionStep): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, _actionRef, ...rest } = step as ActionStep & { _actionRef?: string };
  // If this step was deserialized from an ActionRef (e.g. { "action": "uuid" }), write it
  // back as an ActionRef to keep the JSON clean and avoid duplicating mutation config.
  if (_actionRef) return { action: _actionRef };
  return rest;
}

// ─── Project workflow type def (not in ACTION_CATEGORIES — injected dynamically) ─
export const RUN_PROJECT_WORKFLOW_DEF: ActionTypeDef = {
  type: 'runProjectWorkflow',
  label: 'Run project workflow',
  icon: '⚡',
};

// ─── Step query helpers ───────────────────────────────────────────────────────

// Static defs for server types not in ACTION_CATEGORIES
const SERVER_TYPE_DEFS: Record<string, ActionTypeDef> = {
  sendResponse:          { type: 'sendResponse',          label: 'Send Response',            icon: '⬆' },
  sendStreamingResponse: { type: 'sendStreamingResponse', label: 'Send Streaming Response',  icon: '⇈' },
  middlewareNext:        { type: 'middlewareNext',         label: 'Next',                     icon: '→' },
  workflowResult:        { type: 'workflowResult',         label: 'Workflow result',           icon: '⚡' },
  runServerFunction:     { type: 'runServerFunction',      label: 'Run server function',       icon: 'ƒ' },
  executeSQL:            { type: 'executeSQL',             label: 'Execute SQL',               icon: '⊞' },
  runFormula:            { type: 'runFormula',             label: 'Run formula',               icon: 'ƒ' },
  throwError:            { type: 'throwError',             label: 'Throw error',               icon: '⚠' },
  tryCatch:              { type: 'tryCatch',               label: 'Try/Catch',                 icon: '⚡', isStructural: true },
  createWorkflowVariable:{ type: 'createWorkflowVariable', label: 'Create workflow variable',  icon: '(x)' },
  hashPassword:          { type: 'hashPassword',           label: 'Hash password',             icon: '🔒' },
  verifyPassword:        { type: 'verifyPassword',         label: 'Verify password',           icon: '🔓' },
  generateToken:         { type: 'generateToken',          label: 'Generate token',            icon: '🔑' },
  verifyToken:           { type: 'verifyToken',            label: 'Verify token',              icon: '🛡' },
};

export function getActionDef(type: ActionStepType): ActionTypeDef | undefined {
  // runProjectWorkflow is not in ACTION_CATEGORIES (it's injected dynamically) — resolve here
  if (type === 'runProjectWorkflow') return RUN_PROJECT_WORKFLOW_DEF;
  // Server-only types not in ACTION_CATEGORIES
  if (type in SERVER_TYPE_DEFS) return SERVER_TYPE_DEFS[type];
  // Search FORM_ACTION_CATEGORY first so form types resolve their human labels
  const formFound = FORM_ACTION_CATEGORY.items.find(i => i.type === type);
  if (formFound) return formFound;
  for (const cat of ACTION_CATEGORIES) {
    const found = cat.items.find(i => i.type === type);
    if (found) return found;
  }
  return undefined;
}

export function getActionLabel(type: ActionStepType): string {
  return getActionDef(type)?.label ?? type;
}

export function getActionIcon(type: ActionStepType): string {
  return getActionDef(type)?.icon ?? '⚡';
}

export function isStructural(type: ActionStepType): boolean {
  return getActionDef(type)?.isStructural ?? false;
}

export function isConfigured(step: ActionStep): boolean {
  return Boolean(step.type) && step.type !== 'unconfigured';
}

export function canTest(step: ActionStep): boolean {
  if (!isConfigured(step)) return false;
  if (step.type === 'breakLoop' || step.type === 'continueLoop') return false;
  return true;
}

/**
 * Returns true when a step has all required fields filled in.
 * Used to show the "Action incomplete" badge on canvas nodes.
 */
export function isStepComplete(step: ActionStep): boolean {
  if (!isConfigured(step)) return false;
  const cfg = step.config ?? {};
  switch (step.type) {
    case 'changeVariableValue':
      // complete once a variable is chosen — value can be filled after
      return Boolean(cfg.variableName);
    case 'navigateTo':
      return Boolean(cfg.path || cfg.routeConfig || cfg.externalUrl);
    case 'graphql':
      return Boolean(cfg.query);
    case 'fetchData':
      return Boolean(cfg.url);
    case 'fetchCollection':
      return Boolean(cfg.collectionId ?? cfg.collectionName ?? cfg.name);
    case 'updateCollection': {
      const hasCollection = Boolean(cfg.collectionId ?? cfg.collectionName ?? cfg.name);
      // Normalize legacy "replace" → "replaceAll"
      const uType = cfg.updateType === 'replace' ? 'replaceAll' : (cfg.updateType as string | undefined);
      const hasUpdateType = Boolean(uType);
      // replaceAll triggers a refetch — data is optional. insert/update require data; delete requires nothing extra.
      const needsData = uType === 'insert' || uType === 'update';
      const hasData = !needsData || (cfg.data !== undefined && cfg.data !== null && cfg.data !== '');
      return hasCollection && hasUpdateType && hasData;
    }
    case 'fetchCollectionsParallel':
      return (Array.isArray(cfg.collections) && (cfg.collections as string[]).some(Boolean)) ||
        (Array.isArray(cfg.collectionNames) && (cfg.collectionNames as string[]).some(Boolean));
    case 'branch':
      return Boolean(cfg.condition);
    case 'forEach':
      return Boolean(cfg.items);
    case 'whileLoop':
      return Boolean(cfg.condition);
    case 'runProjectWorkflow':
      return Boolean(cfg.workflowId || step.action);
    case 'runJavaScript':
      return Boolean(typeof cfg.code === 'string' && (cfg.code as string).trim().length > 0);
    case 'timeDelay':
      return Boolean(cfg.time ?? cfg.delay ?? cfg.ms);
    case 'pickFile':
      return Boolean(cfg.storeIn);
    case 'copyToClipboard':
      return Boolean(cfg.value);
    case 'scrollToElement':
      return Boolean(cfg.elementId ?? cfg.targetId);
    case 'animate':
      return Boolean(cfg.targetNodeId);
    case 'triggerExitAnimation':
      return Boolean(cfg.targetNodeId);
    case 'startLoop':
      return Boolean(cfg.targetNodeId);
    case 'stopLoop':
      return Boolean(cfg.targetNodeId);
    case 'playEnterAnimation':
      return Boolean(cfg.targetNodeId);
    case 'downloadFileFromUrl':
      return Boolean(cfg.url);
    case 'addSharedComponent':
      return Boolean(cfg.componentId);
    case 'deleteSharedComponent':
      return true;
    case 'deleteAllSharedComponents':
      return true;
    case 'resetVariableValue': {
      const names = cfg.variableNames as string[] | undefined;
      return (Array.isArray(names) && names.some(Boolean)) || Boolean(cfg.variableName);
    }
    case 'executeComponentAction':
      return Boolean(cfg.action);
    case 'returnValue':
      return cfg.value !== undefined && cfg.value !== null && cfg.value !== '';
    case 'setFormState':
      // complete when at least one flag is explicitly set (false is a valid value)
      return cfg.isSubmitting !== undefined || cfg.isSubmitted !== undefined;
    // Server types completeness
    case 'tablesList':
      return Boolean(cfg.table);
    case 'tablesInsert':
      return Boolean(cfg.table);
    case 'tablesUpdate':
      return Boolean(cfg.table) && (Boolean(cfg.rowId) || Boolean(cfg.filters));
    case 'tablesDelete':
      return Boolean(cfg.table) && (Boolean(cfg.rowId) || Boolean(cfg.filters));
    case 'executeSQL':
      return Boolean(typeof cfg.query === 'string' && (cfg.query as string).trim().length > 0);
    case 'sendResponse':
      return Boolean(cfg.status) && Boolean(cfg.bodyType);
    case 'workflowResult':
      return Boolean(cfg.resultType);
    case 'runServerFunction':
      return Boolean(cfg.functionId);
    case 'throwError':
      return Boolean(cfg.message);
    case 'createWorkflowVariable':
      return Boolean(cfg.variableName) && Boolean(cfg.variableType);
    case 'serverJavaScript':
      return Boolean(typeof cfg.code === 'string' && (cfg.code as string).trim().length > 0);
    // These are self-contained — no config needed
    case 'submitForm':
    case 'navigatePrev':
    case 'breakLoop':
    case 'continueLoop':
    case 'passThroughCondition':
    case 'stopPropagation':
    case 'printPdf':
    case 'deleteAllSharedComponents':
    case 'resetForm':
    case 'encodeFileAsBase64':
    case 'createUrlFromBase64':
    case 'sendStreamingResponse':
    case 'middlewareNext':
    case 'tryCatch':
      return true;
    default:
      return true;
  }
}

/**
 * Returns a short human-readable summary of a step's key config for display
 * in the canvas card subtext. Returns null if nothing meaningful to show.
 * Pass `varLabels` (id→label map) to resolve variable names for changeVariableValue.
 */
/** Safely converts a config value that may be a plain string or a formula/var object to a displayable string. */
function cfgStr(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val || null;
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    if (typeof o.formula === 'string') return o.formula.slice(0, 40) || null;
    if (typeof o.js === 'string') return (o.js.split('\n').find(l => l.trim()) ?? o.js).trim().slice(0, 40) || null;
    if (typeof o.var === 'string') return o.var.slice(0, 40) || null;
    if (typeof o.expr === 'string') return o.expr.slice(0, 40) || null;
  }
  return String(val).slice(0, 40) || null;
}

export function getStepSummary(
  step: ActionStep,
  varLabels?: Record<string, string>,
  collectionNames?: Record<string, string>,
): string | null {
  const cfg = step.config ?? {};
  switch (step.type) {
    case 'changeVariableValue': {
      const rawVId = cfg.variableName;
      // Formula variableName (e.g. SC writing to its own instance page slot)
      if (rawVId != null && typeof rawVId === 'object' && 'formula' in (rawVId as object)) {
        return 'instance variable';
      }
      const vId = rawVId as string | undefined;
      if (!vId) return null;
      const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      return varLabels?.[vId] ?? (uuidRe.test(vId) ? '(unknown variable)' : vId.split('.').pop() ?? vId);
    }
    case 'resetVariableValue': {
      const names = (cfg.variableNames as string[] | undefined) ?? (cfg.variableName ? [cfg.variableName as string] : []);
      const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      const resolved = names.filter(Boolean).map(id => varLabels?.[id as string] ?? (uuidRe.test(id as string) ? '(unknown variable)' : (id as string).split('.').pop() ?? id));
      return resolved.length > 0 ? resolved.join(', ') : null;
    }
    case 'executeComponentAction': {
      const wfId = cfg.action as string | undefined;
      if (!wfId) return null;
      // varLabels also carries workflow names keyed by UUID (built from store.workflows in ActionNode)
      return varLabels?.[wfId] ?? null;
    }
    case 'navigateTo':
      return cfgStr(cfg.externalUrl) || cfgStr(cfg.path) || cfgStr(cfg.routeConfig) || null;
    case 'graphql':
      return cfgStr(cfg.operationName) || 'GraphQL request';
    case 'fetchData':
      return cfgStr(cfg.url) || null;
    case 'fetchCollection':
    case 'updateCollection': {
      const cId = (cfg.collectionId ?? cfg.collectionName ?? cfg.name) as string | undefined;
      if (!cId) return null;
      // collectionNames is keyed by datasource UUID; if cId is an action UUID, collectionNames also has action→label mapping
      return collectionNames?.[cId] ?? cId;
    }
    case 'fetchCollectionsParallel': {
      const cols = ((cfg.collections ?? cfg.collectionNames) as string[] | undefined) ?? [];
      const names = cols.filter(Boolean).map(id => collectionNames?.[id] ?? id);
      return names.length > 0 ? names.join(', ') : null;
    }
    case 'runProjectWorkflow':
      return (cfg.workflowId as string) || (step.action as string) || null;
    case 'runJavaScript': {
      const code = (cfg.code as string | undefined) ?? '';
      if (!code) return null;
      const oneLine = code.split('\n').find(l => l.trim()) ?? code;
      return oneLine.trim().slice(0, 40);
    }
    case 'timeDelay': {
      const ms = cfg.time ?? cfg.delay ?? cfg.ms;
      return ms != null ? `${ms}ms` : null;
    }
    case 'forEach': {
      const fi = cfg.items;
      if (!fi) return null;
      if (typeof fi === 'object' && fi !== null) {
        const o = fi as Record<string, unknown>;
        if (typeof o.formula === 'string') return o.formula.slice(0, 40);
        if (typeof o.js === 'string') return (o.js.split('\n').find(l => l.trim()) ?? o.js).trim().slice(0, 40);
      }
      return String(fi).slice(0, 40);
    }
    case 'branch':
      return cfg.condition ? cfgStr(cfg.condition) : null;
    case 'whileLoop':
      return cfg.condition ? cfgStr(cfg.condition) : null;
    case 'copyToClipboard':
      return cfgStr(cfg.value);
    case 'scrollToElement':
      return cfgStr(cfg.elementId) || cfgStr(cfg.targetId) || null;
    case 'animate':
      return cfg.targetNodeId ? `${cfg.animation ?? 'pulse'} → ${cfg.targetNodeId}` : null;
    case 'triggerExitAnimation':
      return cfg.targetNodeId ? `→ ${cfg.targetNodeId}` : null;
    case 'startLoop':
      return cfg.targetNodeId ? `${cfg.loopType ?? 'pulse'} → ${cfg.targetNodeId}` : null;
    case 'stopLoop':
      return cfg.targetNodeId ? `stop → ${cfg.targetNodeId}` : null;
    case 'playEnterAnimation':
      return cfg.targetNodeId ? `${cfg.enterType ?? 'fadeIn'} → ${cfg.targetNodeId}` : null;
    case 'returnValue':
      return cfg.value !== undefined ? cfgStr(cfg.value) : null;
    case 'tablesList': {
      const table = cfgStr(cfg.table) ?? cfgStr(cfg.tableId);
      if (!table) return null;
      const filters = (cfg.filters as unknown[] | undefined) ?? [];
      return filters.length > 0
        ? `${table} · ${filters.length} filter${filters.length > 1 ? 's' : ''}`
        : `${table} · no filters`;
    }
    case 'tablesGet': {
      const table = cfgStr(cfg.table) ?? cfgStr(cfg.tableId);
      if (!table) return null;
      return `${table} · by id`;
    }
    case 'tablesInsert': {
      const table = cfgStr(cfg.table) ?? cfgStr(cfg.tableId);
      return table ?? null;
    }
    case 'tablesUpdate': {
      const table = cfgStr(cfg.table) ?? cfgStr(cfg.tableId);
      if (!table) return null;
      const filters = (cfg.filters as unknown[] | undefined) ?? [];
      return filters.length > 0 ? `${table} · ${filters.length} filter${filters.length > 1 ? 's' : ''}` : table;
    }
    case 'tablesDelete': {
      const table = cfgStr(cfg.table) ?? cfgStr(cfg.tableId);
      if (!table) return null;
      const filters = (cfg.filters as unknown[] | undefined) ?? [];
      return filters.length > 0 ? `${table} · ${filters.length} filter${filters.length > 1 ? 's' : ''}` : table;
    }
    case 'executeSQL': {
      const sql = cfgStr(cfg.query) ?? cfgStr(cfg.sql);
      return sql ? sql.trim().slice(0, 40) : null;
    }
    default:
      return null;
  }
}

export function generateId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createPlaceholderStep(): ActionStep {
  return { id: generateId(), type: 'unconfigured' };
}
