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
  | 'setFormState'
  | 'resetForm'
  // Actions category
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
  | 'runProjectWorkflow'
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
      { value: 'scroll',     label: 'On scroll' },
      { value: 'escapeKey',  label: 'On Escape key' },
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

export function getTriggerCategories(nodeType?: string): TriggerCategory[] {
  const elementOptions = nodeType ? (ELEMENT_TRIGGERS[nodeType] ?? []) : [];
  const cats: TriggerCategory[] = [];
  if (elementOptions.length) {
    cats.push({ category: 'Element triggers', options: elementOptions });
  }
  return [...cats, ...UNIVERSAL_TRIGGER_CATEGORIES];
}

export function getTriggerLabel(value: string, nodeType?: string): string {
  const all = getTriggerCategories(nodeType).flatMap(c => c.options);
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

export interface ActionTypeDef {
  type: ActionStepType;
  label: string;
  icon: string;
  isStructural?: boolean;
}

export const ACTION_CATEGORIES: { category: string; items: ActionTypeDef[] }[] = [
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
    ],
  },
  {
    category: 'Actions',
    items: [
      // runProjectWorkflow is NOT listed here — it appears dynamically as "Project workflows"
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
  // "Project workflows" is injected dynamically in AddActionPopover (not a fixed category)
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
    items: [
      { type: 'stopPropagation', label: 'Stop click propagation', icon: '🖱' },
      { type: 'printPdf', label: 'Print PDF', icon: '🖨' },
      { type: 'copyToClipboard', label: 'Copy to clipboard', icon: '📋' },
      { type: 'downloadFileFromUrl', label: 'Download file from URL', icon: '</>' },
      { type: 'createUrlFromBase64', label: 'Create URL from Base64', icon: '</>' },
      { type: 'encodeFileAsBase64', label: 'Encode file as Base64', icon: '</>' },
      { type: 'animate', label: 'Trigger animation', icon: '✨' },
    ],
  },
  {
    category: 'Popup',
    items: [
      { type: 'openPopup', label: 'Open popup', icon: '⊞' },
      { type: 'closeAllPopups', label: 'Close all popups', icon: '⊞' },
      { type: 'closePopup', label: 'Close popup', icon: '⊞' },
    ],
  },
];

// Form-specific actions — injected into TypeSearchDropdown only when inside a FormContainer
export const FORM_ACTION_CATEGORY: { category: string; items: ActionTypeDef[] } = {
  category: 'Other',
  items: [
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

export function getActionDef(type: ActionStepType): ActionTypeDef | undefined {
  // runProjectWorkflow is not in ACTION_CATEGORIES (it's injected dynamically) — resolve here
  if (type === 'runProjectWorkflow') return RUN_PROJECT_WORKFLOW_DEF;
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
    case 'timeDelay':
      return Boolean(cfg.time ?? cfg.delay ?? cfg.ms);
    case 'copyToClipboard':
      return Boolean(cfg.value);
    case 'downloadFileFromUrl':
      return Boolean(cfg.url);
    case 'openPopup':
      return Boolean(cfg.popupId);
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
    // These are self-contained — no config needed
    case 'navigatePrev':
    case 'breakLoop':
    case 'continueLoop':
    case 'passThroughCondition':
    case 'stopPropagation':
    case 'printPdf':
    case 'closeAllPopups':
    case 'resetForm':
    case 'uploadFile':
    case 'encodeFileAsBase64':
    case 'createUrlFromBase64':
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
export function getStepSummary(
  step: ActionStep,
  varLabels?: Record<string, string>,
  collectionNames?: Record<string, string>,
): string | null {
  const cfg = step.config ?? {};
  switch (step.type) {
    case 'changeVariableValue': {
      const vId = cfg.variableName as string | undefined;
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
      // varLabels also carries workflow names keyed by UUID (built from pageWorkflowMeta in ActionNode)
      return varLabels?.[wfId] ?? null;
    }
    case 'navigateTo':
      return (cfg.externalUrl as string) || (cfg.path as string) || (cfg.routeConfig as string) || null;
    case 'graphql':
      return (cfg.operationName as string) || 'GraphQL request';
    case 'fetchData':
      return (cfg.url as string) || null;
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
    case 'timeDelay': {
      const ms = cfg.time ?? cfg.delay ?? cfg.ms;
      return ms != null ? `${ms}ms` : null;
    }
    case 'forEach': {
      const fi = cfg.items;
      if (!fi) return null;
      if (typeof fi === 'object' && fi !== null && 'formula' in (fi as object))
        return ((fi as Record<string, string>).formula ?? '').slice(0, 40);
      return String(fi).slice(0, 40);
    }
    case 'branch':
      return cfg.condition ? String(cfg.condition).slice(0, 40) : null;
    case 'whileLoop':
      return cfg.condition ? String(cfg.condition).slice(0, 40) : null;
    case 'copyToClipboard':
      return cfg.value ? String(cfg.value).slice(0, 30) : null;
    case 'returnValue':
      return cfg.value !== undefined ? String(cfg.value).slice(0, 30) : null;
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
