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

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useBuilderStore, findNode, hasFormContainerAncestor } from './_store';
import type { WorkflowCanvasTarget, WorkflowMeta } from './_store';
import { BindingIcon, isBoundValue, type FormulaValue } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';
import {
  type ActionStepType, type BranchDef, type ActionStep, type ActionTypeDef,
  ACTION_CATEGORIES, FORM_ACTION_CATEGORY,
  getTriggerCategories, getTriggerLabel, getTriggerIcon, TI,
  getActionDef, getActionLabel, getActionIcon, isStructural, isConfigured, canTest,
  generateId, createPlaceholderStep, deserializeStep, deserializeStepArray, serializeStep,
} from './_workflow-types';

// ─── Extracted modules ───────────────────────────────────────────────────────
import { S } from './_workflow-styles';
import {
  toHumanName, WorkflowBindButton,
  TypeSearchDropdown, WorkflowMetaPanel, CanvasOnOffToggle,
  NavigateToConfig, SetFormStateConfig, ResetFormConfig,
  NodePropsPanel,
} from './_workflow-node-configs';
import {
  getStepAtPath, updateStepAtPath, insertStepAtPath, removeStepAtPath,
  pathEquals, Connector,
  FlowRenderer, type FlowRendererProps,
  WorkflowCanvasContext,
} from './_workflow-flow-nodes';

// Re-export for backward compat (other files import these from _workflow-canvas)
export { toHumanName, WorkflowBindButton } from './_workflow-node-configs';
export type { FlowRendererProps } from './_workflow-flow-nodes';

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
  onTestStep,
}: {
  state: ContextMenuState;
  copiedStep: ActionStep | null;
  onClose: () => void;
  onDisable: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTestStep: () => void;
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
    canTestStep ? { label: 'Test action', shortcut: 'ENTER', action: () => { onTestStep(); onClose(); } } : null,
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
  onSelectWorkflow,
  onPaste,
  onClose,
  isFormContext = false,
  globalWorkflows = [],
}: {
  copiedStep: ActionStep | null;
  onSelect: (type: ActionStepType) => void;
  onSelectWorkflow: (workflowId: string, workflowName: string) => void;
  onPaste: () => void;
  onClose: () => void;
  isFormContext?: boolean;
  globalWorkflows?: { id: string; name: string }[];
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

  // Filter global workflows by search query
  const filteredWorkflows = globalWorkflows.filter(w =>
    !q || w.name.toLowerCase().includes(q)
  );

  // Inject "Project workflows" between Actions and GraphQL when any workflows match
  const categoriesWithWorkflows = (() => {
    if (filteredWorkflows.length === 0) return filtered;
    // Find the split point: insert after "Actions", before "GraphQL"
    const actionsIdx = filtered.findIndex(c => c.category === 'Actions');
    const insertAt = actionsIdx >= 0 ? actionsIdx + 1 : filtered.length;
    return [
      ...filtered.slice(0, insertAt),
      { category: '__projectWorkflows__', items: [] as ActionTypeDef[] },
      ...filtered.slice(insertAt),
    ];
  })();

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
      {categoriesWithWorkflows.map(cat => (
        <div key={cat.category}>
          {cat.category === '__projectWorkflows__' ? (
            <>
              <div style={S.dropdownCategory}>Project workflows</div>
              {filteredWorkflows.map(wf => (
                <button
                  key={wf.id}
                  style={S.dropdownItem(false)}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#374151'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  onClick={() => { onSelectWorkflow(wf.id, wf.name); onClose(); }}
                >
                  <span style={{ fontSize: 12 }}>⚡</span>
                  <span>{wf.name}</span>
                </button>
              ))}
            </>
          ) : (
            <>
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
            </>
          )}
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

  // ── Global workflows list for "Project workflows" section in AddActionPopover ─
  const globalWorkflowsList = useMemo(() => {
    return Object.entries(store.globalWorkflowMeta ?? {}).map(([id, meta]) => ({
      id,
      name: (meta as { name?: string }).name ?? id,
    }));
  }, [store.globalWorkflowMeta]);

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
      if (Array.isArray(nodeActions) && nodeActions.length > 0) {
        // Wrapped format: [{ type: 'workflowSteps', trigger, steps: [...] }]
        // This is what handleClose now saves so the engine can dispatch it.
        const first = (nodeActions as unknown[])[0] as Record<string, unknown>;
        if (first?.type === 'workflowSteps' && Array.isArray(first.steps)) {
          setTriggerValue((first.trigger as string) ?? (target.event || firstTrigger));
          initialSteps = deserializeStepArray(first.steps as unknown[], dam);
      } else {
          // Legacy flat steps array (backward compat)
          initialSteps = deserializeStepArray(nodeActions as unknown[], dam);
        }
      } else if (!Array.isArray(nodeActions) && nodeActions) {
        // Legacy event-keyed object format
        const existing = (nodeActions as Record<string, unknown>)?.[target.event];
      const rawArr: unknown[] = Array.isArray(existing) ? existing : existing ? [existing] : [];
        initialSteps = deserializeStepArray(rawArr, dam);
      }
      setSteps(initialSteps);
    } else if (target.kind === 'globalWorkflow') {
      const meta = store.globalWorkflowMeta[target.id];
      setWorkflowMeta(meta ?? { id: target.id, name: 'Workflow' });
      const rawGlobal = (store.globalWorkflows[target.id] ?? []) as unknown[];
      initialSteps = deserializeStepArray(rawGlobal, store.directActionsMap);
      setSteps(initialSteps);
    } else if (target.kind === 'pageWorkflow') {
      const meta = store.pageWorkflowMeta?.[target.name];
      setWorkflowMeta({ id: target.name, name: target.name, ...meta });
      setTriggerValue(meta?.trigger ?? 'click');
      const rawPage = (store.pageWorkflows[target.name] ?? []) as unknown[];
      initialSteps = deserializeStepArray(rawPage, store.directActionsMap);
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
      // Wrap steps in a workflowSteps container so the SDUI engine's workflowStepsHandler
      // can execute canvas step types (navigateTo, changeVariableValue, etc.) at runtime.
      // The trigger is stored here so action-binding.ts can read it directly from the item.
      const nodeId = target.nodeId;
      const serializedSteps = steps.map(serializeStep);
      const wrapped = serializedSteps.length > 0
        ? [{ type: 'workflowSteps', trigger: triggerValue, steps: serializedSteps }]
        : undefined;
      store.patchNodeField(nodeId, 'actions', wrapped);
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

  // ── Test step ─────────────────────────────────────────────────────────────────
  // Runs a single step through the SDUI engine using the builder's preview data
  // as the merged state. Results are persisted to localStorage via the store.
  const handleTestStep = useCallback(async (step: ActionStep, stepPath: (string | number)[]) => {
    // Lazy-import handlers to avoid circular deps at module load time
    const [{ dispatchToHandler }, { getGlobalVariableStore }] = await Promise.all([
      import('@/lib/sdui/actions/handlers'),
      import('@/lib/sdui/global-variable-store'),
    ]);
    const { workflowStepsHandler } = await import('@/lib/sdui/actions/handlers/workflow-steps-handler');

    // Build a minimal state from builder preview data
    const previewData = store.appPreviewData ?? {};
    const vsState = getGlobalVariableStore().getState().getFullState?.() ?? {};
    const merged = { ...previewData, ...vsState };

    let stepResult: unknown = undefined;
    let stepError: unknown = null;

    // Stable key: prefer the step's own ID (preserved from JSON, e.g. "step-login") so
    // the key is consistent across canvas reloads and matches formula chips that reference it.
    // Fall back to stepPath for steps without original IDs.
    const stableKey = step.id || stepPath.join('.');
    const stepIndex = typeof stepPath[stepPath.length - 1] === 'number'
      ? stepPath[stepPath.length - 1] as number
      : 0;
    const actionName = (step as { name?: string }).name || step.type || 'Action';

    // Minimal runOne that only handles inline action types (no named action lookup)
    const runOne = async (a: import('@/lib/sdui/types').SDUIAction): Promise<unknown> => {
      const def = a as unknown as Record<string, unknown>;
      if (!def.type) return undefined;
      const handlerCtx = buildHandlerCtx();
      const result = await dispatchToHandler(def as import('@/lib/sdui/actions/handlers/types').ActionDef, handlerCtx);
      return result !== false ? result : undefined;
    };

    function buildHandlerCtx(): import('@/lib/sdui/actions/handlers/types').ActionHandlerContext {
      const testData: Record<string, unknown> = { ...merged };
      return {
        get: (path: string) => {
          // Simple nested lookup from test data
          const parts = path.split('.');
          let cur: unknown = testData;
          for (const p of parts) {
            if (cur == null || typeof cur !== 'object') return undefined;
            cur = (cur as Record<string, unknown>)[p];
          }
          return cur;
        },
        getFullMergedState: () => merged as Record<string, unknown>,
        setData: (path: string, value: unknown) => { testData[path] = value; },
        setLoading: () => {},
        setError: (_storeIn: string, error: unknown) => {
          if (error) stepError = error;
        },
        append: () => {},
        runOne,
        store: { getState: () => ({ setState: () => {} }) },
        configName: 'builder-test',
        actionName: step.type ?? 'unknown',
        CONVENTIONS: store.engineConventions ?? {},
        setStepResult: (result, error) => {
          stepResult = result;
          if (error) stepError = error;
        },
      };
    }

    try {
      const handlerCtx = buildHandlerCtx();
      // Wrap in a workflowSteps so the existing converter maps the canvas step type
      const wfDef = { type: 'workflowSteps', steps: [step] } as import('@/lib/sdui/actions/handlers/types').ActionDef;
      await workflowStepsHandler(handlerCtx)(wfDef);
    } catch (err) {
      // Store full error object so the formula picker can show all fields
      stepError = err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack, ...(err as unknown as Record<string, unknown>) }
        : err;
    }

    // Use stableKey (stepPath-based) so re-running the same step always replaces its entry
    store.setWorkflowStepTestResult(stableKey, stepResult, stepError, stepIndex, actionName);
  }, [store]);

  // Memoise the context value so FlowRenderer sub-trees don't re-render needlessly
  const canvasCtxValue = useMemo(() => ({
    onTestStep: handleTestStep,
    testResults: store.workflowTestResults,
  }), [handleTestStep, store.workflowTestResults]);

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
              <WorkflowCanvasContext.Provider value={canvasCtxValue}>
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
              </WorkflowCanvasContext.Provider>

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
            onSelectWorkflow={(workflowId, workflowName) => {
              addStep('runProjectWorkflow', addPopoverState.insertIdx, addPopoverState.pathPrefix);
              // After adding, update the step config with the workflow ID and name
              const insertedPath = [...addPopoverState.pathPrefix, addPopoverState.insertIdx];
              setSelectedPath(insertedPath);
              // Patch config directly via a deferred update so the step is in state first
              setTimeout(() => {
                updateSelectedStep({ config: { workflowId }, name: workflowName });
              }, 0);
              setAddPopoverState(null);
            }}
            onPaste={() => { pasteStep(addPopoverState.insertIdx, addPopoverState.pathPrefix); setAddPopoverState(null); }}
            onClose={() => setAddPopoverState(null)}
            isFormContext={isFormContext}
            globalWorkflows={globalWorkflowsList}
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
          onTestStep={() => handleTestStep(contextMenuState.step, contextMenuState.path)}
        />
      )}
    </div>
  );
}
