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
import type { WorkflowCanvasTarget, WorkflowMeta, WorkflowParam } from './_store';
import { backendWorkflows } from '@/lib/platform/api-client';
import { getSharedComponents, updateSharedComponent } from '@/lib/builder/shared-component-data';
import type { SharedComponentModel } from '@/config/shared-component-types';
import { useSduiStore } from '@/store/sdui-store';

function getLinkedModel(modelId: string): SharedComponentModel | undefined {
  return getSharedComponents()[modelId];
}
function updateLinkedModel(patch: Partial<SharedComponentModel> & { id: string }): void {
  updateSharedComponent(patch);
}

/** Derives a stable ID that uniquely identifies the open workflow, used to scope test results. */
function workflowIdFromTarget(t: WorkflowCanvasTarget): string {
  switch (t.kind) {
    case 'element':            return `element:${t.nodeId}:${t.event}`;
    case 'pageTrigger':        return `pageTrigger:${t.trigger}`;
    case 'pageWorkflow':       return `pageWorkflow:${t.name}`;
    case 'globalWorkflow':     return `globalWorkflow:${t.id}`;
    case 'componentWorkflow':  return `componentWorkflow:${t.modelId}:${t.workflowId}`;
    case 'serverWorkflow':     return `serverWorkflow:${t.workflowId}`;
  }
}
import { BindingIcon, isBoundValue, type FormulaValue } from './_formula-panel';
import { FormulaEditor } from './_formula-editor';
import {
  type ActionStepType, type BranchDef, type ActionStep, type ActionTypeDef,
  ACTION_CATEGORIES, FORM_ACTION_CATEGORY, getServerActionCategories,
  getTriggerCategories, getTriggerLabel, getTriggerIcon, TI,
  TRIGGER_WORKFLOW_CATEGORIES, COMPONENT_TRIGGER_CATEGORIES,
  getActionDef, getActionLabel, getActionIcon, isStructural, isConfigured, canTest,
  generateId, createPlaceholderStep, deserializeStep, deserializeStepArray, serializeStep,
} from './_workflow-types';

// ─── Extracted modules ───────────────────────────────────────────────────────
import { S } from './_workflow-styles';
import {
  toHumanName, WorkflowBindButton,
  TypeSearchDropdown, WorkflowMetaPanel, CanvasOnOffToggle,
  NavigateToConfig, SetFormStateConfig, ResetFormConfig,
  NodePropsPanel, ParamsConfigPanel,
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
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onTestStep,
}: {
  state: ContextMenuState;
  copiedStep: ActionStep | null;
  onClose: () => void;
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
    canTestStep ? null : null,
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
          <div key={i} style={{ height: 1, background: 'var(--bld-text-1)', margin: '2px 0' }} />
        ) : (
          <button
            key={i}
            style={S.contextItem(item.danger)}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = item.danger ? 'rgba(248,113,113,0.12)' : 'var(--bld-border-subtle)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
            onClick={item.action}
          >
            <span>{item.label}</span>
            {item.shortcut && <span style={{ fontSize: 10, color: 'var(--bld-text-3)' }}>{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}

// ─── Parameters Canvas Node ───────────────────────────────────────────────────
// Shown between the trigger pill and the first workflow step for global workflows.
// Clicking it selects it and shows ParamsConfigPanel in the right panel.

const PARAM_TYPE_PILL_ICONS: Record<string, string> = {
  Text: 'T',
  Number: '#',
  Boolean: '◎',
  Object: '{}',
  Array: '[]',
};

function ParametersCanvasNode({
  params,
  isSelected,
  onClick,
}: {
  params: WorkflowParam[];
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const subtext = params.length === 0
    ? 'Click to add parameters'
    : params.map(p => `${PARAM_TYPE_PILL_ICONS[p.type] ?? 'T'} ${p.name}`).join('  ·  ');

  return (
    <div
      data-testid="workflow-params-node"
      onClick={onClick}
      style={S.card(isSelected, false)}
    >
      <div style={S.cardTopRow}>
        <span style={{ ...S.cardIcon, color: 'var(--bld-info)' }}>Φ</span>
        <span style={S.cardName}>Parameters</span>
        {params.length > 0 && (
          <span style={{
            fontSize: 10, background: 'var(--bld-bg-elevated)', color: 'var(--bld-info)',
            borderRadius: 10, padding: '1px 7px', fontWeight: 600, flexShrink: 0,
          }}>
            {params.length}
          </span>
        )}
      </div>
      <div style={S.cardSubtext(false)}>{subtext}</div>
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
  isServerContext = false,
  serverWfKind = 'API_ENDPOINT',
  globalWorkflows = [],
  serverFunctions = [],
}: {
  copiedStep: ActionStep | null;
  onSelect: (type: ActionStepType) => void;
  onSelectWorkflow: (workflowId: string, workflowName: string) => void;
  onPaste: () => void;
  onClose: () => void;
  isFormContext?: boolean;
  isServerContext?: boolean;
  serverWfKind?: 'API_ENDPOINT' | 'FUNCTION' | 'MIDDLEWARE';
  globalWorkflows?: { id: string; name: string }[];
  serverFunctions?: { id: string; name: string }[];
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

  const baseCategories = (isFormContext
    ? [FORM_ACTION_CATEGORY, ...ACTION_CATEGORIES]
    : ACTION_CATEGORIES) as Array<{ category: string; context?: 'client' | 'server'; items: ActionTypeDef[] }>;

  // In server context use WeWeb-style server categories
  const allCategories = isServerContext
    ? getServerActionCategories(serverWfKind)
    : baseCategories;

  const q = search.toLowerCase();
  const filtered = allCategories.map(cat => ({
    ...cat,
    items: cat.items.filter(i => i.label.toLowerCase().includes(q)),
  })).filter(cat => cat.items.length > 0);

  // Filter global workflows by search query
  const filteredWorkflows = globalWorkflows.filter(w =>
    !q || w.name.toLowerCase().includes(q)
  );

  // Filter server functions by search query
  const filteredServerFunctions = serverFunctions.filter(f =>
    !q || f.name.toLowerCase().includes(q)
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
          style={{ ...S.dropdownItem(false), fontWeight: 600, borderBottom: '1px solid var(--bld-border-subtle)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
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
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
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
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
              onClick={() => { onSelect(item.type); onClose(); }}
            >
              <span style={{ fontSize: 12 }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
          {/* Inject server functions into the Functions category */}
          {isServerContext && cat.category === 'Functions' && filteredServerFunctions.map(fn => (
            <button
              key={fn.id}
              style={S.dropdownItem(false)}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-hover)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
              onClick={() => { onSelectWorkflow(fn.id, fn.name); onClose(); }}
            >
              <span style={{ fontSize: 12 }}>ƒ</span>
              <span>{fn.name}</span>
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
  categories: categoriesOverride,
  onChange,
  onClose,
}: {
  value: string;
  nodeType?: string;
  /** When provided, use these categories instead of the default getTriggerCategories list. */
  categories?: import('./_workflow-types').TriggerCategory[];
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const cats = categoriesOverride ?? getTriggerCategories(nodeType);
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
              <span style={{ display: 'flex', alignItems: 'center', color: 'var(--bld-text-3)', flexShrink: 0 }}>
                {getTriggerIcon(opt.value)}
              </span>
              <span style={{ flex: 1 }}>{opt.label}</span>
              {opt.value === value && <span style={{ color: 'var(--bld-accent)', fontSize: 10 }}>✓</span>}
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
  const canDelete = target.kind === 'pageWorkflow' || target.kind === 'globalWorkflow' || target.kind === 'componentWorkflow' || target.kind === 'serverWorkflow';

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
    background: 'transparent', border: 'none', color: 'var(--bld-text-2)',
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
        background: 'var(--bld-bg-input)', border: '1px solid var(--bld-border-subtle)', borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)', minWidth: 160, overflow: 'hidden',
      }}
    >
      {canDelete && (
        <button
          style={{ ...itemStyle, color: 'var(--bld-error)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(248,113,113,0.12)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-bg-input)'; }}
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
  /** When true, renders as a flex child filling its container instead of a fixed full-screen overlay. */
  inline?: boolean;
}

export function WorkflowCanvas({ target, onClose, inline = false }: WorkflowCanvasProps) {
  const store = useBuilderStore();

  // Sync inline canvas target into the store so FormulaEditor can match test results
  // and determine the correct workflow context (e.g. server workflows).
  // Uses a dedicated field so it never triggers the fullscreen overlay in page.tsx.
  useEffect(() => {
    if (!inline) return;
    store.setInlineWorkflowCanvasTarget(target);
    return () => { store.setInlineWorkflowCanvasTarget(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline, JSON.stringify(target)]);

  // ── Global workflows list for "Project workflows" section in AddActionPopover ─
  const globalWorkflowsList = useMemo(() => {
    return Object.entries(store.globalWorkflowMeta ?? {}).map(([id, meta]) => ({
      id,
      name: (meta as { name?: string }).name ?? id,
    }));
  }, [store.globalWorkflowMeta]);

  // Server FUNCTION-kind workflows for injection into Functions category
  const [serverFunctionsList, setServerFunctionsList] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (target.kind !== 'serverWorkflow') return;
    backendWorkflows.list(target.projectId).then((res) => {
      setServerFunctionsList(
        (res.workflows ?? [])
          .filter((w: { kind: string }) => w.kind === 'FUNCTION')
          .map((w: { id: string; name: string }) => ({ id: w.id, name: w.name }))
      );
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind === 'serverWorkflow' ? (target as { projectId: string }).projectId : null]);

  // ── Local state ─────────────────────────────────────────────────────────────
  const [steps, setSteps] = useState<ActionStep[]>([]);
  const [serverWfKind, setServerWfKind] = useState<'API_ENDPOINT' | 'FUNCTION' | 'MIDDLEWARE'>('API_ENDPOINT');
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
  // Sentinel: true when the Parameters node (global workflow only) is selected
  const [paramsNodeSelected, setParamsNodeSelected] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);
  const [workflowMeta, setWorkflowMeta] = useState<WorkflowMeta>({ id: '', name: 'Workflow' });
  const [workflowMenuAnchor, setWorkflowMenuAnchor] = useState<DOMRect | null>(null);
  const workflowMenuBtnRef = useRef<HTMLButtonElement>(null);

  // ── History (undo/redo) ───────────────────────────────────────────────────────
  const historyRef = useRef<ActionStep[][]>([]);
  const historyIdxRef = useRef(-1);
  // Keep live ref so undo/redo always sees current value without stale closures
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Push live step tree to the store so the formula editor can build accurate
  // step-index chips (Action 1, Action 2…) without waiting for canvas close/save.
  useEffect(() => {
    store.setLiveCanvasSteps(steps as object[]);
  }, [steps]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentSteps = steps;
  const setCurrentSteps = setSteps;

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
        // Wrapped format: [{ trigger, params, steps: [...] }] — single wrapper item with a steps array.
        const first = (nodeActions as unknown[])[0] as Record<string, unknown>;
        if (Array.isArray(first?.steps)) {
          setTriggerValue((first.trigger as string) ?? (target.event || firstTrigger));
          const elementParams = (first.params as WorkflowParam[] | undefined) ?? [];
          setWorkflowMeta(prev => ({ ...prev, params: elementParams }));
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
    } else if (target.kind === 'componentWorkflow') {
      const scModel = getLinkedModel(target.modelId);
      const wf = scModel?.workflows?.[target.workflowId];
      const trigger = wf?.trigger ?? 'execution';
      setTriggerValue(trigger);
      setWorkflowMeta({
        id: target.workflowId,
        name: wf?.name ?? 'Workflow',
        params: (wf?.params as WorkflowParam[] | undefined) ?? [],
      });
      initialSteps = wf?.steps ? deserializeStepArray(wf.steps as unknown[], store.directActionsMap) : [];
      setSteps(initialSteps);
    } else if (target.kind === 'serverWorkflow') {
      backendWorkflows.get(target.projectId, target.workflowId).then((res) => {
        const wf = res.workflow;
        setWorkflowMeta({
          id:     wf.id,
          name:   wf.name,
          params: (wf.inputSchema as WorkflowParam[] | undefined) ?? [],
        });
        if (wf.kind) setServerWfKind(wf.kind as 'API_ENDPOINT' | 'FUNCTION' | 'MIDDLEWARE');
        const rawGraph = Array.isArray(wf.graph) ? wf.graph as unknown[] : [];
        const loaded = deserializeStepArray(rawGraph, store.directActionsMap);
        setSteps(loaded);
        historyRef.current = [loaded];
        historyIdxRef.current = 0;
      }).catch(() => {/* workflow may not exist yet — start empty */});
    }
    // Seed history with the initial state so undo never goes past it
    historyRef.current = [initialSteps];
    historyIdxRef.current = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Copy workflow JSON ────────────────────────────────────────────────────────
  function handleCopyJson() {
    const serialized = steps.map(serializeStep);
    const json = JSON.stringify(serialized, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    });
  }

  // ── Save & close ─────────────────────────────────────────────────────────────
  function handleClose() {
    if (target.kind === 'element') {
      // Store as a single-item array with trigger + steps so action-binding.ts can read
      // the trigger directly and the engine auto-detects it as a workflow via the steps array.
      const nodeId = target.nodeId;
      const serializedSteps = steps.map(serializeStep);
      const elementParams = workflowMeta.params ?? [];
      const wrapped = serializedSteps.length > 0
        ? [{
            trigger: triggerValue,
            ...(elementParams.length > 0 ? { params: elementParams } : {}),
            steps: serializedSteps,
          }]
        : undefined;
      store.patchNodeField(nodeId, 'actions', wrapped);
    } else if (target.kind === 'globalWorkflow') {
      store.setGlobalWorkflow(target.id, steps as object[]);
      store.setGlobalWorkflowMeta(target.id, workflowMeta);
    } else if (target.kind === 'pageWorkflow') {
      store.setPageWorkflow(target.name, steps as object[]);
      store.setPageWorkflowMeta(target.name, { ...workflowMeta, trigger: triggerValue });
    } else if (target.kind === 'componentWorkflow') {
      const scModel = getLinkedModel(target.modelId);
      if (scModel) {
        const existing = scModel.workflows?.[target.workflowId] ?? {};
        updateLinkedModel({
          id: target.modelId,
          workflows: {
            ...(scModel.workflows ?? {}),
            [target.workflowId]: {
              ...existing,
              id: target.workflowId,
              name: workflowMeta.name ?? 'Workflow',
              trigger: triggerValue as import('@/config/shared-component-types').ScopedWorkflow['trigger'],
              params: (workflowMeta.params ?? []) as Array<{ id: string; name: string; type: 'Text' | 'Number' | 'Boolean' | 'Object' | 'Array'; testValue?: unknown }>,
              steps: steps.map(serializeStep) as import('@/config/shared-component-types').ScopedWorkflowStep[],
            },
          },
        });
      }
    } else if (target.kind === 'serverWorkflow') {
      void backendWorkflows.update(target.projectId, target.workflowId, {
        graph: steps.map(serializeStep) as unknown,
        name: workflowMeta.name,
        inputSchema: (workflowMeta.params ?? []) as unknown,
      });
    }
    onClose();
  }

  // ── Trigger info ─────────────────────────────────────────────────────────────
  const targetNodeType = (() => {
    if (target.kind === 'element') return findNode(store.pageNodes, target.nodeId)?.type as string | undefined;
    if (target.kind === 'pageWorkflow' && target.nodeId) return findNode(store.pageNodes, target.nodeId)?.type as string | undefined;
    return undefined;
  })();
  // When the workflow is bound to an SC instance (node has `_shared`),
  // surface that component model's custom triggers in the picker
  // so a listener workflow can subscribe to events like "On date selected".
  const targetCustomTriggers = (() => {
    if (target.kind !== 'element' && target.kind !== 'pageWorkflow') return undefined;
    const nodeId = target.kind === 'element' ? target.nodeId : target.nodeId;
    if (!nodeId) return undefined;
    const n = findNode(store.pageNodes, nodeId) as unknown as Record<string, unknown> | undefined;
    if (!n) return undefined;
    const shared = n._shared as { id: string } | undefined;
    const meta = shared;
    if (!meta) return undefined;
    const model = getLinkedModel(meta.id);
    const triggers = model?.triggers ?? [];
    return triggers.length ? triggers : undefined;
  })();
  // pageWorkflow and element both have an editable trigger; globalWorkflow/pageTrigger are fixed
  const isComponentWorkflow = target.kind === 'componentWorkflow';
  const isFixedTrigger = target.kind !== 'element' && target.kind !== 'pageWorkflow' && !isComponentWorkflow;
  // Component workflows accept BOTH DOM-event triggers (element-scoped, e.g.
  // the day cell's `click`) and Component-Lifecycle triggers (execution /
  // created / mounted / …). The picker offers both categories; the label
  // helper searches both so a `click`-triggered component workflow correctly
  // renders as "On click" in the pill.
  const componentTriggerLabel = (v: string): string => {
    const compHit = COMPONENT_TRIGGER_CATEGORIES.flatMap(c => c.options).find(o => o.value === v);
    if (compHit) return compHit.label;
    return getTriggerLabel(v, undefined);
  };
  const triggerLabel = target.kind === 'serverWorkflow'
    ? (serverWfKind === 'API_ENDPOINT' ? 'On API request' : 'On execution')
    : isFixedTrigger
      ? 'On execution'
      : isComponentWorkflow
        ? componentTriggerLabel(triggerValue)
        : getTriggerLabel(triggerValue, targetNodeType, targetCustomTriggers);
  // Trigger workflows (from the Triggers tab) use a restricted set of trigger options
  const isTriggerWorkflow = target.kind === 'pageWorkflow' && !!store.pageWorkflowMeta?.[target.name]?.isTrigger;
  const triggerCategories = isComponentWorkflow
    ? [...COMPONENT_TRIGGER_CATEGORIES, ...getTriggerCategories(undefined)]
    : isTriggerWorkflow
      ? TRIGGER_WORKFLOW_CATEGORIES
      : targetCustomTriggers
        // Build a bespoke category list that includes the instance's component
        // events alongside the standard element / universal triggers.
        ? getTriggerCategories(targetNodeType, targetCustomTriggers)
        : undefined;
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
  function pushHistory(newSteps: ActionStep[]) {
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(newSteps);
    historyIdxRef.current = historyRef.current.length - 1;
  }

  function undo() {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    setSteps(historyRef.current[historyIdxRef.current]);
  }

  function redo() {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    setSteps(historyRef.current[historyIdxRef.current]);
  }

  // ── Step mutations ────────────────────────────────────────────────────────────
  function addStep(type: ActionStepType, insertIdx: number, pathPrefix: (string | number)[]) {
    const newStep: ActionStep = {
      id: generateId(),
      type,
      trueBranch: type === 'branch' ? [createPlaceholderStep()] : undefined,
      falseBranch: type === 'branch' ? [createPlaceholderStep()] : undefined,
      branches: type === 'multiOptionBranch' ? [
        { match: 'First value', steps: [createPlaceholderStep()] },
        { match: 'Second value', steps: [createPlaceholderStep()] },
        { match: 'Third value', steps: [createPlaceholderStep()] },
      ] : undefined,
      loopBody: (type === 'forEach' || type === 'whileLoop') ? [createPlaceholderStep()] : undefined,
      tryBody:  type === 'tryCatch' ? [createPlaceholderStep()] : undefined,
      catchBody: type === 'tryCatch' ? [createPlaceholderStep()] : undefined,
      config: type === 'tryCatch' ? { catchEnabled: true, finallyEnabled: false } : undefined,
    };
    const cur = stepsRef.current;
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
    const cur = stepsRef.current;
    const next = pathPrefix.length === 0
      ? (() => { const c = [...cur]; c.splice(insertIdx, 0, pasted); return c; })()
      : insertStepAtPath(cur, [...pathPrefix, insertIdx] as number[], pasted);
    setCurrentSteps(next);
    pushHistory(next);
    setSelectedPath([...pathPrefix, insertIdx]);
  }

  function updateSelectedStep(patch: Partial<ActionStep>) {
    if (!selectedPath) return;
    const cur = stepsRef.current;
    const next = updateStepAtPath(cur, selectedPath as number[], s => ({ ...s, ...patch }));
    setCurrentSteps(next);
    pushHistory(next);
  }

  function deleteStep(path: (string | number)[]) {
    const cur = stepsRef.current;
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
    const cur = stepsRef.current;
    const next = parentPath.length === 0
      ? (() => { const c = [...cur]; c.splice(idx + 1, 0, dup); return c; })()
      : insertStepAtPath(cur, [...parentPath, idx + 1] as number[], dup);
    setCurrentSteps(next);
    pushHistory(next);
  }

  function toggleDisableStep(path: (string | number)[]) {
    const cur = stepsRef.current;
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
    if (tag === 'try' && step.tryBody) return getStepFromPath(step.tryBody, subPath);
    if (tag === 'catch' && step.catchBody) return getStepFromPath(step.catchBody, subPath);
    if (tag === 'finally' && step.finallyBody) return getStepFromPath(step.finallyBody, subPath);
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
    // Only use the step's explicit name — type names like "fetchData" are not human-readable labels.
    // Empty string signals the display layer to show "Action N" (index-based fallback).
    const actionName = (step as { name?: string }).name || '';

    // runOne that handles both inline type-based actions and named action references
    // (e.g. { action: 'fetchTodo', payload: ... } from runProjectWorkflow step conversion)
    const runOne = async (a: import('@/lib/sdui/types').SDUIAction): Promise<unknown> => {
      const def = a as unknown as Record<string, unknown>;
      // Named action reference — look up the definition and dispatch as a workflow
      if (!def.type && typeof def.action === 'string') {
        const { getBuilderConfig } = await import('@/lib/builder/config-data');
        const cfg = getBuilderConfig();
        const named = (cfg.workflows as Array<{ id: string; steps: unknown[] }> | undefined)
          ?.find(w => w.id === def.action);
        if (named) {
          const resultRef: { current: unknown } = { current: undefined };
          const innerCtx = {
            ...buildHandlerCtx(),
            payload: (def.payload as Record<string, unknown> | undefined) ?? {},
            setStepResult: (r: unknown) => { resultRef.current = r; },
          };
          const { workflowStepsHandler: wsh } = await import('@/lib/sdui/actions/handlers/workflow-steps-handler');
          await wsh(innerCtx)(named as import('@/lib/sdui/actions/handlers/types').ActionDef);
          return resultRef.current;
        }
        return undefined;
      }
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
        setData: (path: string, value: unknown) => {
          testData[path] = value;
          // Also write to the real Zustand store so the formula editor's
          // auth tab (and other live subscriptions) reflect test run results.
          useSduiStore.getState().setData(path, value);
        },
        setLoading: () => {},
        setError: (_storeIn: string, error: unknown) => {
          if (error) stepError = error;
        },
        append: () => {},
        runOne,
        store: { getState: () => ({ setState: () => {} }) },
        configName: 'builder-test',
        actionName: step.type ?? 'unknown',
        setStepResult: (result, error) => {
          stepResult = result;
          if (error) stepError = error;
        },
      };
    }

    try {
      const handlerCtx = buildHandlerCtx();
      const wfDef = { steps: [step] } as import('@/lib/sdui/actions/handlers/types').ActionDef;
      await workflowStepsHandler(handlerCtx)(wfDef);
    } catch (err) {
      // Store full error object so the formula picker can show all fields
      stepError = err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack, ...(err as unknown as Record<string, unknown>) }
        : err;
    }

    // Use stableKey (stepPath-based) so re-running the same step always replaces its entry.
    // Pass workflowId so the formula picker can filter to only this workflow's results.
    store.setWorkflowStepTestResult(stableKey, stepResult, stepError, stepIndex, actionName, workflowIdFromTarget(target));
  }, [store, target]);

  // Memoise the context value so FlowRenderer sub-trees don't re-render needlessly
  const canvasCtxValue = useMemo(() => ({
    onTestStep: handleTestStep,
    testResults: store.workflowTestResults,
  }), [handleTestStep, store.workflowTestResults]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // When the user is typing in an input / textarea / contenteditable
      // surface (e.g. the formula editor or a CodeMirror JS editor opened
      // from a runJavaScript step) defer to native browser behavior. Without
      // this, Cmd+X / Cmd+C / Cmd+D / Cmd+V would treat the selected step as
      // the target and e.g. delete the step instead of cutting the editor's
      // text selection. We DO still let `Escape` close the canvas overlay
      // since users expect that.
      const t = e.target as HTMLElement | null;
      const isInput = !!t?.closest?.('input, textarea, [contenteditable="true"], .cm-editor');
      if (isInput && e.key !== 'Escape') return;

      // Always stop propagation so the builder's window listener never sees keys
      // that the canvas has handled (or is about to handle).
      e.stopImmediatePropagation();
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
          if (e.key === 'x') { e.preventDefault(); setCopiedStep({ ...selectedStep }); deleteStep(selectedPath); }
        }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPath) {
        e.preventDefault();
        deleteStep(selectedPath);
      }
    }
    // Capture phase ensures this fires before the builder's bubble-phase listener
    // regardless of registration order, so stopImmediatePropagation works correctly.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
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
    <div data-testid="workflow-canvas" style={inline ? { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bld-bg-base)' } : S.overlay} onClick={() => { setTriggerDropdownOpen(false); setAddPopoverState(null); setContextMenuState(null); }}>
      {/* Top bar */}
      <div style={S.topBar} onClick={e => e.stopPropagation()}>
        {/* Left: workflow name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {target.kind === 'globalWorkflow' || target.kind === 'pageWorkflow' || target.kind === 'componentWorkflow' || target.kind === 'serverWorkflow' ? toHumanName(workflowMeta.name) : 'Workflow'}
          </span>
        </div>
        {/* Copy JSON */}
        <button
          data-testid="workflow-canvas-copy-json"
          style={{ ...S.closeBtn, color: copiedJson ? 'var(--bld-success)' : 'var(--bld-text-3)' }}
          onClick={handleCopyJson}
          title="Copy workflow steps as JSON"
        >
          <span style={{ fontSize: 13 }}>{copiedJson ? '✓' : '{}'}</span>
          {copiedJson ? 'Copied!' : 'Copy JSON'}
        </button>
        {/* Right: Close */}
        <button data-testid="workflow-canvas-close" style={S.closeBtn} onClick={handleClose}>
          <span style={{ fontSize: 14 }}>×</span> Close
        </button>
      </div>

      {/* Content area */}
      <div style={S.contentArea}>
        {/* Canvas */}
        <div ref={canvasAreaRef} style={S.canvasArea} onClick={() => { setSelectedPath(null); setParamsNodeSelected(false); }}>
          {/* Figma-style dot grid */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.18 }}>
            <defs>
              <pattern id="wf-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.8" fill="var(--bld-text-disabled)" />
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
                  <span style={{ display: 'flex', alignItems: 'center', color: 'var(--bld-warning)', flexShrink: 0 }}>
                    {isFixedTrigger ? <TI.Zap /> : getTriggerIcon(triggerValue)}
                  </span>
                  <span>{triggerLabel}</span>
                  {!isFixedTrigger && <span style={{ fontSize: 10, color: 'var(--bld-text-3)' }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline-block",verticalAlign:"middle"}}><polyline points="6 9 12 15 18 9"/></svg></span>}
                </div>
                {triggerDropdownOpen && !isFixedTrigger && (
                  <TriggerDropdown
                    value={triggerValue}
                    nodeType={targetNodeType}
                    categories={triggerCategories}
                    onChange={v => setTriggerValue(v)}
                    onClose={() => setTriggerDropdownOpen(false)}
                  />
                )}
              </div>

              {/* Parameters node — shown for every workflow kind */}
              <Connector />
              <ParametersCanvasNode
                params={workflowMeta.params ?? []}
                isSelected={paramsNodeSelected}
                onClick={e => {
                  e.stopPropagation();
                  setParamsNodeSelected(true);
                  setSelectedPath(null);
                }}
              />

              {/* Main flow */}
              <Connector />
              <WorkflowCanvasContext.Provider value={canvasCtxValue}>
              <FlowRenderer
                steps={currentSteps}
                pathPrefix={[]}
                selectedPath={selectedPath}
                copiedStep={copiedStep}
                onSelect={p => { setSelectedPath(p); setParamsNodeSelected(false); }}
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
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-2)', flex: 1 }}>Workflow</span>
            {/* Workflow options menu */}
            <button
              ref={workflowMenuBtnRef}
              data-testid="workflow-panel-menu-btn"
              style={{ background: 'none', border: 'none', color: 'var(--bld-text-3)', cursor: 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1, borderRadius: 4 }}
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
                  } else if (target.kind === 'componentWorkflow') {
                    const scModel = getLinkedModel(target.modelId);
                    if (scModel?.workflows) {
                      const { [target.workflowId]: _removed, ...rest } = scModel.workflows;
                      updateLinkedModel({ id: target.modelId, workflows: rest });
                    }
                  } else if (target.kind === 'serverWorkflow') {
                    void backendWorkflows.delete(target.projectId, target.workflowId);
                  }
                  onClose();
                }}
              />
            )}
          </div>

          {/* Panel body */}
          <div data-testid="workflow-props-panel" style={S.rightPanelBody}>
            {paramsNodeSelected ? (
              <ParamsConfigPanel
                params={workflowMeta.params ?? []}
                onChange={params => setWorkflowMeta(prev => ({ ...prev, params }))}
              />
            ) : selectedStep ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--bld-text-1)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, paddingBottom: 8, borderBottom: 'none' }}>
                  <span style={{ fontSize: 14 }}>{getActionIcon(selectedStep.type)}</span>
                  <span>{selectedStep.name || getActionLabel(selectedStep.type)}</span>
                </div>
                <NodePropsPanel
                  step={selectedStep}
                  onUpdate={patch => updateSelectedStep(patch)}
                  isFormContext={isFormContext}
                  workflowTrigger={triggerValue}
                  componentTriggers={
                    target.kind === 'componentWorkflow'
                      ? (getLinkedModel(target.modelId)?.triggers ?? [])
                      : undefined
                  }
                  isServerContext={target.kind === 'serverWorkflow'}
                  projectId={target.kind === 'serverWorkflow' ? (target as { projectId: string }).projectId : undefined}
                  serverFunctions={serverFunctionsList}
                  priorSteps={
                    target.kind === 'serverWorkflow' && selectedPath
                      ? currentSteps.slice(0, selectedPath[0] as number)
                      : undefined
                  }
                  formulaParams={
                    target.kind === 'serverWorkflow'
                      ? (workflowMeta.params ?? []) as import('./_store-types').GlobalFormulaParam[]
                      : undefined
                  }
                />
              </>
            ) : (target.kind === 'globalWorkflow' || target.kind === 'pageWorkflow' || target.kind === 'componentWorkflow') ? (
              <WorkflowMetaPanel
                meta={workflowMeta}
                onChange={patch => setWorkflowMeta(prev => ({ ...prev, ...patch }))}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--bld-text-3)', fontSize: 12, textAlign: 'center', padding: 24, gap: 8 }}>
                <span style={{ fontSize: 32, opacity: 0.3 }}>⚡</span>
                <span style={{ fontWeight: 600, color: 'var(--bld-text-disabled)' }}>Select an action</span>
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
            isServerContext={target.kind === 'serverWorkflow'}
            serverWfKind={serverWfKind}
            globalWorkflows={globalWorkflowsList}
            serverFunctions={serverFunctionsList}
          />
        </div>
      )}

      {/* Context menu */}
      {contextMenuState && (
        <ContextMenuPopup
          state={contextMenuState}
          copiedStep={copiedStep}
          onClose={() => setContextMenuState(null)}
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
