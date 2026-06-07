'use client';

/**
 * WeWeb-style Formula Editor
 *
 * Replaces both FormulaPanel (variables/template/expression modes) and
 * ExprBuilder (visual/ifthen/template/raw/preview-JSON modes).
 *
 * Layout (matches screenshot):
 *   Header:   label | Formula ▾ | Unbind | ↗ | ×
 *   Input:    monospace formula textarea
 *   Preview:  Current value  |  Expected format ?
 *   Tabs:     {x} Variables  |  ≡ Data  |  Auth
 *   Body:     Searchable collapsible function categories or variable tree
 *   Footer:   Operators bar  =  !=  and  or  +  -  *
 */

import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { useBuilderStore, findNode, findParentNode, type DataSourceConfig, type SDUINode } from './_store';
import { findSharedRoot } from './_store-node-helpers';
import { useShallow } from 'zustand/react/shallow';
import { getSharedComponents } from '@/lib/builder/shared-component-data';

// ─── Tab content components (extracted to _formula-editor-tabs.tsx) ───────────
export { Tooltip, VariableTree, CollectionEntry, DataTreeNode, FunctionLibrary, FnRow,
  ContextDataSection, PagesDataSection, ColorsDataSection, TypographyDataSection,
  BorderRadiusDataSection, CollectionsDataTab, PageComponentsSection, AuthDataSection,
  type VarRowItem } from './_formula-editor-tabs';
import {
  Tooltip, VariableTree, CollectionEntry,
  CollectionsDataTab, PageComponentsSection, FormLocalSection, ItemContextGroup,
  DataTreeNode, FEChevron, collectPageComponents, EVENT_SHAPES, EventContextSection,
  SharedComponentContextSection, AuthDataSection, ParametersSection, FunctionLibrary,
  type VarRowItem,
} from './_formula-editor-tabs';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import { setNestedValue } from '@/lib/sdui/nested-utils';
import routesConfig from '@/config/routes.json';
import themeConfig from '@/config/theme.json';

import {
  type FormulaValue,
  type EvalResult,
  evaluateFormula,
  formulaToStoredValue,
  storedValueToFormula,
  isBoundValue,
  FORMULA_FNS,
} from '@/lib/sdui/formula-evaluator';

// Re-export for backward-compat consumers (_formula-panel, _expr-builder)
export type { FormulaValue, EvalResult };
export { evaluateFormula, formulaToStoredValue, storedValueToFormula, isBoundValue, FORMULA_FNS };

// ─── DOM chip utilities (extracted to _formula-editor-dom.ts) ─────────────────
export type { FnDef } from './_formula-editor-dom';
export {
  highlightJson,
  buildFormulaPath, buildDisplayLabel, pathToFormulaAndDisplay,
  serializeEditor, normalizeEditorContent, serializeRangeFromEditor,
  CHIP_RE, CHIP_INNER_CSS, CHIP_STYLE,
  buildChipSpan, insertChipAtCaret, insertPlainTextAtCaret,
  FUNCTION_LIBRARY, OPERATORS,
  OP_CHIP, OP_STYLE, buildOperatorChip, OP_TOKEN_RE, OP_INSERT_MAP,
  AUTO_CHIP_RE, AUTO_CHIP_TYPED_MAP, rechipCurrentTextNode,
  KNOWN_FN_NAMES, FN_NAME_RE, FN_NAME_SUFFIX_RE, setUserFormulaNames,
  buildFunctionChip, countSignatureCommas, insertFunctionChipsAtCaret,
  insertOperatorChipAtCaret,
  appendTextSegment, appendTextWithOperatorChips,
  contextPathToChipFormula, insertPastedFormulaAtCaret, populateEditor,
} from './_formula-editor-dom';
import {
  type FnDef,
  highlightJson,
  buildFormulaPath, buildDisplayLabel,
  serializeEditor, normalizeEditorContent, serializeRangeFromEditor,
  CHIP_RE,
  buildChipSpan, insertChipAtCaret, insertPlainTextAtCaret,
  FUNCTION_LIBRARY, OPERATORS,
  OP_STYLE,
  buildOperatorChip,
  rechipCurrentTextNode,
  buildFunctionChip, insertFunctionChipsAtCaret,
  insertOperatorChipAtCaret,
  appendTextWithOperatorChips,
  contextPathToChipFormula, insertPastedFormulaAtCaret, populateEditor,
  pathToFormulaAndDisplay,
  buildIdentifierForJs,
} from './_formula-editor-dom';
import { JavaScriptEditor, type JavaScriptEditorHandle } from './_javascript-editor';
import { isJsBoundValue } from '@/lib/sdui/formula-evaluator';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'variables' | 'data' | 'quick' | 'workflow' | 'auth' | 'formulas';

export interface FormulaEditorProps {
  label: string;
  value: FormulaValue;
  onChange: (v: FormulaValue) => void;
  onClose: () => void;
  expectedType?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';
  /** Human-readable hint describing the expected value format, e.g. "e.g. 200px, 50%, auto" */
  hint?: string;
  /**
   * Which side the editor should open from.
   * 'right' — editor appears to the left of the right panel (right panel is 260px wide).
   * 'left'  — editor appears to the right of the left panel (default, left panel is 248px wide).
   */
  anchor?: 'left' | 'right';
  /**
   * Override the left position in pixels (e.g. 568 for a slide panel that is 320px wide
   * placed after the 248px left panel). When set, takes precedence over `anchor`.
   */
  anchorLeft?: number;
  /**
   * Override the right position in pixels (e.g. 292 for the workflow canvas whose right
   * panel is 288px wide). When set, takes precedence over `anchor` and `anchorLeft`.
   */
  anchorRight?: number;
  /** When true, the Unbind button in the header is hidden */
  hideUnbind?: boolean;
  /**
   * The trigger type of the enclosing workflow (e.g. 'change', 'click', 'submit').
   * When set, an "Event" section is shown in the Quick tab with the event shape for that trigger,
   * and `event` is injected into the formula preview evaluation context.
   */
  workflowTrigger?: string;
  /**
   * Formula parameters for the formula body editor (passed when editing a global formula body).
   * When provided, a PARAMETERS section is shown in the Workflow tab so users can reference
   * parameters?.['paramName'] in the formula expression.
   */
  formulaParams?: import('./_store-types').GlobalFormulaParam[];
  /**
   * When true, formula params are shown in the Quick tab instead of the Workflow tab.
   * Use this when the formula editor is opened from a component-scoped formula (where
   * the Quick tab already shows component context).
   */
  paramsInQuick?: boolean;
  /**
   * Lock the editor into JavaScript mode and hide the Formula | JavaScript dropdown.
   * Used by the runJavaScript workflow step config so the side tabs (Variables, Data,
   * Formulas, Quick) are available but the user can never switch into chip-formula mode.
   */
  lockToJs?: boolean;
  /**
   * When true (server workflow context), only the Workflow tab is shown.
   * Variables, Data, Formulas, and Auth tabs are hidden since they are
   * client-side only and irrelevant to server-side step binding.
   */
  serverContext?: boolean;
}

// ─── WorkflowResultsTab ───────────────────────────────────────────────────────

import type { WorkflowTestEntry } from './_store-types';

/**
 * Shows persisted test results from workflow canvas "▶ Test" button runs.
 * Groups entries as "FROM ACTION 1 / 2 / …" sorted by stepIndex.
 * Clicking a leaf path inserts context.workflow['stepId'].result?.path as a chip.
 * Design matches the Quick tab's DataTreeNode style (orange chips, FEChevron arrows).
 */
function WorkflowResultsTab({
  testResults,
  stepNameMap,
  onSelect,
}: {
  testResults: Record<string, WorkflowTestEntry>;
  stepNameMap: Map<string, string>;
  onSelect: (stepId: string, path: string, actionIndex: number, source: 'result' | 'error') => void;
}) {
  const sorted = Object.entries(testResults).sort((a, b) => a[1].stepIndex - b[1].stepIndex);

  if (sorted.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: 11, color: '#6b7280', textAlign: 'center' }}>
        No test results yet.<br />
        Run a step with the ▶ button in the workflow canvas.
      </div>
    );
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {sorted.map(([stepId, entry], idx) => (
        <WorkflowResultGroup
          key={stepId}
          stepId={stepId}
          entry={entry}
          label={stepNameMap.get(stepId) || entry.actionName || `Action ${idx + 1}`}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// Blue chip scheme for result nodes
const WF_RESULT_CHIP = { bg: '#1d4ed8', bgHover: '#2563eb', border: '#2563eb', text: '#bfdbfe' };
// Red chip scheme for error nodes
const WF_ERROR_CHIP  = { bg: '#991b1b', bgHover: '#b91c1c', border: '#b91c1c', text: '#fecaca' };

function WorkflowResultGroup({
  stepId, entry, label, onSelect,
}: {
  stepId: string;
  entry: WorkflowTestEntry;
  label: string;
  onSelect: (stepId: string, path: string, actionIndex: number, source: 'result' | 'error') => void;
}) {
  const [open, setOpen] = React.useState(true);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set(['result', 'error']));
  const [arrayIndices, setArrayIndices] = React.useState<Map<string, number>>(new Map());

  const toggleExpand = (p: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n;
  });
  const setArrayIndex = (p: string, idx: number) => setArrayIndices(prev => new Map(prev).set(p, idx));

  // Strip the leading "result." or "error." prefix — source is passed separately
  const handleResultInsert = (rawPath: string) => {
    const subPath = rawPath === 'result' ? '' : rawPath.replace(/^result\./, '');
    onSelect(stepId, subPath, 0, 'result');
  };
  const handleErrorInsert = (rawPath: string) => {
    const subPath = rawPath === 'error' ? '' : rawPath.replace(/^error\./, '');
    onSelect(stepId, subPath, 0, 'error');
  };

  // Error can be a full object (Axios error with request/response) or a plain string
  const errorValue: unknown = entry.error != null
    ? (typeof entry.error === 'object'
        ? entry.error
        : { message: String(entry.error) })
    : null;

  return (
    <div style={{ borderBottom: '1px solid #1f2937' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer',
          color: '#e5e7eb', fontSize: 11, fontWeight: 600, textAlign: 'left',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
      >
        <span style={{ color: '#6b7280' }}><FEChevron open={open} size={8} /></span>
        <span style={{ fontSize: 10, letterSpacing: '0.05em', color: '#9ca3af', marginRight: 2 }}>FROM ACTION</span>
        <span style={{ fontSize: 11 }}>{label}</span>
      </button>

      {open && (
        <div style={{ paddingBottom: 4 }}>
          {/* result node — always shown in blue */}
                      <DataTreeNode
            fieldName="result"
            path="result"
            value={entry.result ?? null}
            depth={0}
            onInsert={handleResultInsert}
            expanded={expanded}
            toggleExpand={toggleExpand}
            arrayIndices={arrayIndices}
            setArrayIndex={setArrayIndex}
            chipColor={WF_RESULT_CHIP}
          />
          {/* error node — shown in red only when there is an error */}
          {entry.error !== null && (
                      <DataTreeNode
              fieldName="error"
              path="error"
              value={errorValue}
              depth={0}
              onInsert={handleErrorInsert}
              expanded={expanded}
              toggleExpand={toggleExpand}
              arrayIndices={arrayIndices}
              setArrayIndex={setArrayIndex}
              chipColor={WF_ERROR_CHIP}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── FormulaEditor ────────────────────────────────────────────────────────────

export function FormulaEditor({ label, value, onChange, onClose, expectedType = 'any', hint, anchor = 'left', anchorLeft, anchorRight, hideUnbind, workflowTrigger, formulaParams, paramsInQuick, lockToJs, serverContext = false }: FormulaEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  // Undo/redo history
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { globalFormulas, pageDataSources, customVars, varFolders, workflowTestResults, workflowCanvasTarget: _overlayTarget, inlineWorkflowCanvasTarget, pageWorkflows, globalWorkflows, liveCanvasSteps, globalWorkflowMeta } = useBuilderStore(
    useShallow(s => ({
      globalFormulas: s.globalFormulas, pageDataSources: s.pageDataSources,
      customVars: s.customVars, varFolders: s.varFolders,
      workflowTestResults: s.workflowTestResults, workflowCanvasTarget: s.workflowCanvasTarget,
      inlineWorkflowCanvasTarget: s.inlineWorkflowCanvasTarget,
      pageWorkflows: s.pageWorkflows, globalWorkflows: s.globalWorkflows,
      liveCanvasSteps: s.liveCanvasSteps,
      globalWorkflowMeta: s.globalWorkflowMeta,
    }))
  );
  // Inline canvases (e.g. ServerWorkflowsPanel) sync via inlineWorkflowCanvasTarget to avoid
  // triggering the fullscreen overlay. Use whichever is active.
  const workflowCanvasTarget = _overlayTarget ?? inlineWorkflowCanvasTarget;
  const selectedIds = useBuilderStore(s => s.selectedIds);
  const selectedMapIndex = useBuilderStore(s => s.selectedMapIndex);
  const pageNodes = useBuilderStore(s => s.pageNodes);
  const editingSharedComponentId = useBuilderStore(s => s.editingSharedComponentId);
  const [isFocused, setIsFocused] = useState(false);

  // Detect if the selected node is inside a repeated context (has a map ancestor)
  const isInsideRepeat = useMemo(() => {
    const id = selectedIds[0];
    if (!id) return false;
    let node = findNode(pageNodes, id);
    while (node) {
      if (node.map) return true;
      const parent = findParentNode(pageNodes, node.id ?? '');
      node = parent ?? null;
    }
    return false;
  }, [selectedIds, pageNodes]);

  // Detect if the selected node is a FormContainer or has one as an ancestor.
  // Also returns the nearest ancestor FormContainer's id so FormLocalSection can
  // read from the right isolated variables['{id}-form'] store key.
  const { isInsideForm, nearestFormContainerId } = useMemo(() => {
    const id = selectedIds[0];
    if (!id) return { isInsideForm: false, nearestFormContainerId: null };
    // Check the selected node itself first
    const selfNode = findNode(pageNodes, id);
    if ((selfNode as { type?: string })?.type === 'FormContainer') {
      return { isInsideForm: true, nearestFormContainerId: selfNode?.id ?? id };
    }
    let node = findParentNode(pageNodes, id);
    while (node) {
      if ((node as { type?: string }).type === 'FormContainer') {
        return { isInsideForm: true, nearestFormContainerId: node.id ?? null };
      }
      const parent = findParentNode(pageNodes, node.id ?? '');
      node = parent ?? null;
    }
    return { isInsideForm: false, nearestFormContainerId: null };
  }, [selectedIds, pageNodes]);
  // Subscribe to live Zustand data so context stays fresh
  const zustandData = useSduiStore(s => s.data);

  // Subscribe to the global variable store so the context memo re-runs when
  // new variables are seeded (e.g. after addCustomVar) and formula evaluation
  // reflects the latest values without needing to reopen the editor.
  const [vsData, setVsData] = useState<Record<string, unknown>>(() =>
    getGlobalVariableStore().getState().getFullState() as Record<string, unknown>
  );
  useEffect(() => {
    const store = getGlobalVariableStore();
    const unsub = store.subscribe(() => {
      setVsData(store.getState().getFullState() as Record<string, unknown>);
    });
    return unsub;
  }, []);

  // Derive initial formula string from stored value
  const initialFormula = useMemo(() => {
    const raw = storedValueToFormula(value);
    // hideUnbind flags formula-only contexts (e.g. validation expressions) where the value
    // must remain a bare expression — never wrap it in string-literal quotes there.
    if (hideUnbind) return raw;
    // When the stored value is a plain string (formulaToStoredValue stripped the surrounding
    // quotes from a string literal like "/product-details"), we must re-add the quotes so the
    // formula editor always shows the correct "…" / '…' syntax — regardless of expectedType.
    // Without this, reopening a URL / path field would show /product-details instead of
    // "/product-details", and re-saving would convert it to a JS expression (division / regex).
    if (raw && typeof value === 'string' && !isBoundValue(value)) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          return JSON.stringify(parsed, null, 2);
        }
      } catch { /* not JSON */ }
      if (!isNaN(Number(raw)) && raw.trim() !== '') return raw;
      return JSON.stringify(raw);
    }
    return raw;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only computed once on mount

  // formula state: serialized string from the contenteditable div
  const [formula, setFormula] = useState(initialFormula);

  // Mode: 'formula' = legacy chip editor, 'js' = CodeMirror JavaScript editor.
  // Initialize from the stored value shape — `{ js: "..." }` opens directly into JS mode.
  // When `lockToJs` is set the editor is permanently in JS mode (mode toggle is hidden).
  const [mode, setMode] = useState<'formula' | 'js'>(() => (lockToJs || isJsBoundValue(value) ? 'js' : 'formula'));
  const [jsCode, setJsCode] = useState<string>(() => {
    if (isJsBoundValue(value)) return (value as { js: string }).js;
    return '';
  });
  const jsEditorRef = useRef<JavaScriptEditorHandle | null>(null);

  // Filter test results to only those belonging to the currently open workflow canvas.
  // Entries from other workflows (e.g. Login, older runs) are excluded so the Workflow
  // tab only shows results relevant to the formula being edited right now.
  const currentWorkflowTestResults = useMemo(() => {
    if (!workflowTestResults) return {} as typeof workflowTestResults;
    if (!workflowCanvasTarget) return workflowTestResults;
    // Derive the same ID used by workflowIdFromTarget in _workflow-canvas.tsx
    const t = workflowCanvasTarget;
    let currentId: string;
    if (t.kind === 'element')              currentId = `element:${t.nodeId}:${t.event}`;
    else if (t.kind === 'pageTrigger')     currentId = `pageTrigger:${t.trigger}`;
    else if (t.kind === 'pageWorkflow')    currentId = `pageWorkflow:${t.name}`;
    else if (t.kind === 'serverWorkflow')  currentId = `serverWorkflow:${t.workflowId}`;
    else if (t.kind === 'componentWorkflow') currentId = `componentWorkflow:${t.modelId}:${t.workflowId}`;
    else                                   currentId = `globalWorkflow:${t.id}`;
    return Object.fromEntries(
      Object.entries(workflowTestResults).filter(([, entry]) => entry.workflowId === currentId)
    ) as typeof workflowTestResults;
  }, [workflowTestResults, workflowCanvasTarget]);

  const sharedAncestorModelId = useMemo(() => {
    if (editingSharedComponentId) return editingSharedComponentId;
    const id = selectedIds[0];
    if (!id) return null;
    const root = findSharedRoot(pageNodes as SDUINode[], id);
    if (!root) return null;
    const meta = (root as unknown as Record<string, unknown>)._shared as { id: string } | undefined;
    return meta?.id ?? null;
  }, [editingSharedComponentId, selectedIds, pageNodes]);

  const isInsideSharedComponent = !!sharedAncestorModelId;
  const showQuickTab = isInsideRepeat || isInsideForm || isInsideSharedComponent;

  const scPropMap = useMemo((): Map<string, string> => {
    if (!sharedAncestorModelId) return new Map();
    const model = getSharedComponents()[sharedAncestorModelId];
    const props = (model as { properties?: Array<{ id: string; name: string }> } | undefined)?.properties ?? [];
    return new Map(props.map(p => [p.name, p.name]));
  }, [sharedAncestorModelId]);

  // UUID → label maps for shared-component variables and formulas so populateEditor
  // can render readable pills for `context.component.variables['UUID']` and
  // `context.component.model.formulas['id'].formula` chips.
  const scVarMap = useMemo((): Map<string, string> => {
    if (!sharedAncestorModelId) return new Map();
    const model = getSharedComponents()[sharedAncestorModelId] as {
      variables?: Record<string, { label?: string }>;
    } | undefined;
    const vars = model?.variables ?? {};
    return new Map(Object.entries(vars).map(([uuid, def]) => [uuid, def.label ?? uuid.slice(0, 8)]));
  }, [sharedAncestorModelId]);

  const scFormulaMap = useMemo((): Map<string, string> => {
    if (!sharedAncestorModelId) return new Map();
    const model = getSharedComponents()[sharedAncestorModelId] as {
      formulas?: Record<string, { name?: string }>;
    } | undefined;
    const fns = model?.formulas ?? {};
    return new Map(Object.entries(fns).map(([id, def]) => [id, def.name ?? id.slice(0, 8)]));
  }, [sharedAncestorModelId]);
  // Show Workflow tab when there are test results OR when a trigger with event data is active
  const hasEventContext = !!(workflowTrigger && Object.keys(EVENT_SHAPES[workflowTrigger] ?? {}).length > 0);
  // Show Workflow tab for global workflows with params too (PARAMETERS section)
  const isGlobalWorkflowWithParams = workflowCanvasTarget?.kind === 'globalWorkflow' &&
    (globalWorkflowMeta[workflowCanvasTarget.id]?.params?.length ?? 0) > 0;
  const globalWorkflowParams = isGlobalWorkflowWithParams && workflowCanvasTarget?.kind === 'globalWorkflow'
    ? (globalWorkflowMeta[workflowCanvasTarget.id]?.params ?? [])
    : [];
  // formulaParams passed from FormulaSlideContent when editing a global formula body
  const hasFormulaParams = (formulaParams?.length ?? 0) > 0;
  // When paramsInQuick is true, params appear in the Quick tab and don't force Workflow tab
  const paramsForceWorkflow = hasFormulaParams && !paramsInQuick;
  // Only surface the Workflow tab when the user is actually editing workflow-adjacent logic.
  // Outside the workflow canvas (e.g. editing a shared-component prop formula) the Workflow
  // tab would otherwise leak in from unrelated cached test results — hide it entirely there.
  const isWorkflowContext = !!workflowCanvasTarget || hasEventContext || paramsForceWorkflow;
  const showWorkflowTab = serverContext || (isWorkflowContext && (
    hasEventContext ||
    Object.keys(currentWorkflowTestResults ?? {}).length > 0 ||
    isGlobalWorkflowWithParams ||
    paramsForceWorkflow
  ));

  const [tab, setTab] = useState<Tab>(() => {
    if (serverContext) return 'workflow';
    if (hasEventContext || paramsForceWorkflow) return 'workflow';
    if (paramsInQuick && hasFormulaParams) return 'quick';
    return 'variables';
  });
  const [search, setSearch] = useState('');

  // Switch to Quick when entering a repeat/form; fall back to Variables when leaving
  // When a workflow trigger with event data is active (or global workflow with params), open the Workflow tab
  useEffect(() => {
    if (hasEventContext || isGlobalWorkflowWithParams || paramsForceWorkflow) setTab('workflow');
    else if (paramsInQuick && hasFormulaParams) setTab('quick');
    else if (isInsideRepeat || isInsideForm || isInsideSharedComponent) setTab('quick');
    else if (tab === 'quick') setTab('variables');
  }, [isInsideRepeat, isInsideForm, isInsideSharedComponent, hasEventContext, isGlobalWorkflowWithParams, paramsForceWorkflow, paramsInQuick, hasFormulaParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map UUID → label for collection chip display
  const dsMap = useMemo(
    () => new Map(
      pageDataSources.map(s => [
        s.storeIn ?? (s as { id?: string }).id ?? '',
        { label: (s as { _label?: string })._label ?? (s as { name?: string }).name ?? s.storeIn ?? '' },
      ])
    ),
    [pageDataSources]
  );

  // Collect all controlled-input nodes and page-level form fields in one pass.
  const { controlledInputVarEntries, formContainerVarEntries, pageFormFields } = useMemo(() => {
    const { standalones, formContainers, pageFormFields: pff } = collectPageComponents(pageNodes, false);
    return {
      controlledInputVarEntries: standalones.map(({ node, insideForm }) => {
        const name = (node as { name?: string }).name
          || (node as { _shared?: { name?: string } })._shared?.name
          || node.type;
        return {
          id: `${node.id!}-value`,
          label: insideForm ? `Form - ${name}` : name,
        };
      }),
      // Form containers keyed by "{id}-form" so populateEditor can show readable labels
      // for variables['formId-form']?.['formData']?.['fieldName'] chips.
      formContainerVarEntries: formContainers
        .map(({ node }) => {
          const id = (node as { id?: string }).id;
          const name = ((node as { name?: string }).name || 'Form').trim();
          return id ? { id: `${id}-form`, label: `Form Container - ${name}` } : null;
        })
        .filter((e): e is { id: string; label: string } => e !== null),
      pageFormFields: pff,
    };
  }, [pageNodes]);

  // Map UUID → label for variable chip display (includes controlled-input virtual vars)
  // Also maps "formId-form" → "Form Container - name" so chips for form-field formulas
  // (variables['formId-form']?.['formData']?.['field']) show readable labels on reopen.
  const varMap = useMemo(
    () => new Map([
      ...customVars
        .filter(v => v.id)
        .map(v => [v.id!, { label: v.label ?? v.name ?? v.id! }] as [string, { label: string }]),
      ...controlledInputVarEntries.map(e => [e.id, { label: e.label }] as [string, { label: string }]),
      ...formContainerVarEntries.map(e => [e.id, { label: e.label }] as [string, { label: string }]),
    ]),
    [customVars, controlledInputVarEntries, formContainerVarEntries]
  );

  // stepId → human-readable action name — lets populateEditor show the same label
  // on reopen as when the chip was first inserted from the Workflow tab.
  // Build stepId → 1-based position from the current workflow's steps (no test run needed).
  // Prefers liveCanvasSteps (pushed by the canvas on every edit) over the persisted store
  // data so the index is always correct even before the canvas is saved/closed.
  // Maps stepId → { pos: 1-based position, name: user-defined step name if set }
  // Derived from liveCanvasSteps (updated on every canvas edit) so position and name
  // are always current — no test run required.
  const staticStepMap = useMemo(() => {
    const map = new Map<string, { pos: number; name?: string }>();
    if (!workflowCanvasTarget) return map;

    // Live steps (updated on every add/remove in the open canvas) take priority
    let rawSteps: unknown[] | undefined = liveCanvasSteps ?? undefined;

    if (!rawSteps) {
      if (workflowCanvasTarget.kind === 'pageWorkflow')
        rawSteps = pageWorkflows[workflowCanvasTarget.name] as unknown[] | undefined;
      else if (workflowCanvasTarget.kind === 'globalWorkflow')
        rawSteps = globalWorkflows[workflowCanvasTarget.id] as unknown[] | undefined;
      else if (workflowCanvasTarget.kind === 'element') {
        const node = pageNodes.find(n => n.id === workflowCanvasTarget.nodeId);
        const actions = (node?.actions as Record<string, unknown> | undefined);
        const wf = actions?.[workflowCanvasTarget.event] as { steps?: unknown[] } | undefined;
        rawSteps = wf?.steps;
      }
    }
    if (!rawSteps) return map;

    let counter = 0;
    const traverse = (steps: unknown[]) => {
      for (const step of steps) {
        const s = step as { id?: string; name?: string; trueBranch?: unknown[]; falseBranch?: unknown[]; loopBody?: unknown[]; branches?: Array<{ steps?: unknown[] }> };
        if (s.id) map.set(s.id, { pos: ++counter, name: s.name || undefined });
        if (s.trueBranch?.length)  traverse(s.trueBranch);
        if (s.falseBranch?.length) traverse(s.falseBranch);
        if (s.loopBody?.length)    traverse(s.loopBody);
        if (s.branches)            for (const b of s.branches) if (b.steps?.length) traverse(b.steps);
      }
    };
    traverse(rawSteps);
    return map;
  }, [workflowCanvasTarget, liveCanvasSteps, pageWorkflows, globalWorkflows, pageNodes]);

  const stepNameMap = useMemo(() => {
    // Build the display label for every known step:
    //   1. Live canvas position/name (staticStepMap) is the primary source — always current.
    //      Name takes priority over index: show the step's user-defined name when set,
    //      otherwise "Action N" using the live 1-based position.
    //   2. Test-result actionName overrides when the step has been explicitly named at
    //      run time (covers renamed steps that haven't reloaded their canvas state yet).
    //   3. For steps not in the static map (canvas closed / step deleted), fall back to
    //      the sorted test-result order so the Workflow tab still shows something useful.
    const map = new Map<string, string>();

    // Step 1: seed from live canvas (name > "Action N")
    for (const [stepId, { pos, name }] of staticStepMap) {
      map.set(stepId, name || `Action ${pos}`);
    }

    // Step 2 & 3: fallback only for steps NOT in the live canvas.
    // The live canvas always wins — if the user renames or clears a step name,
    // staticStepMap already reflects that and we must NOT let a stale cached
    // actionName from a previous test run override it.
    const sorted = Object.entries(currentWorkflowTestResults ?? {})
      .sort(([, a], [, b]) => a.stepIndex - b.stepIndex);
    sorted.forEach(([stepId, entry], idx) => {
      if (!map.has(stepId)) {
        // Step is not in the live canvas (canvas closed / step deleted) →
        // use the cached name or sort-order index as a last resort.
        map.set(stepId, entry.actionName || `Action ${idx + 1}`);
      }
      // Step IS in the live canvas → keep whatever staticStepMap already set.
    });

    return map;
  }, [currentWorkflowTestResults, staticStepMap]);

  // Populate the editor on mount with the initial formula and seed history
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    populateEditor(el, initialFormula, dsMap, varMap, stepNameMap, scPropMap, scVarMap, scFormulaMap);
    setFormula(initialFormula);
    historyRef.current = [initialFormula];
    historyIdxRef.current = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount only

  // Label reactivity: when ds labels change, update collection chip display text in place
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    for (const [uuid, info] of dsMap) {
      const prefix = `collections['${uuid}']`;
      el.querySelectorAll<HTMLElement>(`span[data-formula^="${prefix}"]`).forEach(chip => {
        const formulaPath = chip.dataset.formula!;
        const afterRoot = formulaPath.slice(prefix.length);
        const segs: Array<string | number> = [];
        let rem = afterRoot;
        while (rem.length > 0) {
          const numM = rem.match(/^\?\.\[(\d+)\](.*)/);
          if (numM) { segs.push(Number(numM[1])); rem = numM[2]; continue; }
          const strM = rem.match(/^\?\.\['([^']+)'\](.*)/);
          if (strM) { segs.push(strM[1]); rem = strM[2]; continue; }
          break;
        }
        const inner = chip.querySelector('span') ?? chip;
        inner.textContent = buildDisplayLabel(info.label, segs);
      });
    }
  }, [dsMap]);

  // Label reactivity: when variable labels change, update variable chip display text in place
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    for (const [uuid, info] of varMap) {
      const prefix = `variables['${uuid}']`;
      el.querySelectorAll<HTMLElement>(`span[data-formula^="${prefix}"]`).forEach(chip => {
        const formulaPath = chip.dataset.formula!;
        const afterRoot = formulaPath.slice(prefix.length);
        const segs: Array<string | number> = [];
        let rem = afterRoot;
        while (rem.length > 0) {
          const numM = rem.match(/^\?\.\[(\d+)\](.*)/);
          if (numM) { segs.push(Number(numM[1])); rem = numM[2]; continue; }
          const strM = rem.match(/^\?\.\['([^']+)'\](.*)/);
          if (strM) { segs.push(strM[1]); rem = strM[2]; continue; }
          break;
        }
        const inner = chip.querySelector('span') ?? chip;
        inner.textContent = buildDisplayLabel(info.label, segs);
      });
    }
  }, [varMap]);

  // Label reactivity: when stepNameMap changes (step added/removed), update workflow
  // chip display text in place so "Action N" stays correct without a re-mount.
  // We avoid complex CSS attribute selectors with special chars ([, ') by selecting
  // all collection/error chips and filtering by formula in JS instead.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>('[data-type="collection"],[data-type="error"]').forEach(chip => {
      const formulaPath = chip.dataset.formula ?? '';
      if (!formulaPath.startsWith("context.workflow['")) return;
      const stepIdMatch = formulaPath.match(/^context\.workflow\['([^']*)'\]/);
      if (!stepIdMatch) return;
      const stepId = stepIdMatch[1];
      const actionName = stepNameMap.get(stepId);
      if (!actionName) return;
      const afterStepId = formulaPath.slice(stepIdMatch[0].length);
      const friendly = (actionName + afterStepId).replace(/\?\./g, '.').replace(/\.\[(\d+)\]/g, '[$1]');
      const inner = chip.querySelector('span') ?? chip;
      inner.textContent = friendly;
    });
  }, [stepNameMap]);

  // Build context for evaluation — includes context.item from repeat ancestor, globalContext, pages, theme
  const context = useMemo(() => {
    const vs = vsData;
    // Reconstruct collections map: flat "collections.UUID" keys → nested { UUID: data }.
    const COLL_PREFIX = 'collections.';
    let collStaging: Record<string, unknown> = {};
    const collectionsMap: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(zustandData)) {
      if (k.startsWith(COLL_PREFIX)) {
        collStaging = setNestedValue(collStaging, k.slice(COLL_PREFIX.length), v);
      } else {
      collectionsMap[k] = v;
    }
    }
    Object.assign(collectionsMap, collStaging);

    // SC contexts are built BEFORE the map-ancestor loop so the map evaluator can
    // see `context.component.props.*` while resolving inner maps that read from it
    // (e.g. the DatePicker day-cell map reads `context.component.variables[...]`).
    const scComponentContext = (() => {
      if (!sharedAncestorModelId) return undefined;
      const model = getSharedComponents()[sharedAncestorModelId];
      const props = (model as { properties?: Array<{ id: string; name: string; defaultValue?: unknown }> } | undefined)?.properties ?? [];
      const selId = selectedIds[0];
      const sharedRootNode = selId ? findSharedRoot(pageNodes as SDUINode[], selId) : null;
      const instanceProps = sharedRootNode
        ? ((sharedRootNode as unknown as Record<string, unknown>).props ?? {}) as Record<string, unknown>
        : {};
      const propsMap: Record<string, unknown> = {};
      for (const p of props) {
        let val = p.name in instanceProps ? instanceProps[p.name] : (p.defaultValue ?? '');
        if (val && typeof val === 'object' && 'formula' in (val as Record<string, unknown>)) {
          const f = (val as { formula: string }).formula;
          try {
            val = evaluateFormula(f, { ...zustandData, ...vs, variables: vs }).value;
          } catch {
            val = f;
          }
        }
        propsMap[p.name] = val;
      }
      return { props: propsMap };
    })();

    const scLocalContext = sharedAncestorModelId ? {
      data: { sharedComponent: { instancesCount: 1, index: 0, totalCount: 1 } },
    } : undefined;

    // Resolve context.item from the selected node's repeat ancestors (supports nested repeats)
    let contextItem: Record<string, unknown> | undefined;
    let contextParentItem: Record<string, unknown> | undefined;
    const selectedId = selectedIds[0];
    if (selectedId) {
      // Collect map ancestors (innermost first). The selected node's own map is also
      // included — at runtime, conditions on a REPEAT node are evaluated per-item (inside
      // the item's scope), so the preview should match that by using the first item's context.
      const mapAncestors: string[] = [];
      let walkNode = findNode(pageNodes, selectedId);
      while (walkNode) {
        if (walkNode.map) {
          const raw = walkNode.map;
          const mapStr = typeof raw === 'string'
            ? raw
            : (typeof raw === 'object' && raw !== null)
              ? ((raw as { formula?: string }).formula ?? null)
              : null;
          if (mapStr) mapAncestors.push(mapStr);
        }
        const p = findParentNode(pageNodes, walkNode.id ?? '');
        walkNode = p ?? null;
      }

      // Resolve from outermost to innermost so context-relative inner maps can
      // navigate through the already-resolved outer item. We delegate ALL binding
      // shapes (variables['UUID'], dot paths, complex JS expressions like
      // Array.from(...), and context.item.* relative paths) to evaluateFormula —
      // one code path that mirrors what the runtime engine does.
      for (let ai = mapAncestors.length - 1; ai >= 0; ai--) {
        const mp = mapAncestors[ai];
        const itemCtx = contextItem
          ? {
              ...contextItem,
              data: { ...contextItem, index: 0, repeatIndex: 0, isACopy: false, parent: null, repeatedItems: [contextItem] },
              index: 0, repeatIndex: 0, isACopy: false, parent: null, repeatedItems: [contextItem],
            }
          : undefined;
        const snapshot: Record<string, unknown> = {
          ...zustandData,
          ...vs,
          variables: vs,
          collections: collectionsMap,
          context: {
            ...(itemCtx ? { item: itemCtx, index: 0 } : {}),
            ...(scComponentContext ? { component: scComponentContext } : {}),
            ...(scLocalContext ? { local: scLocalContext } : {}),
          },
        };

        let value: unknown;
        try { value = evaluateFormula(mp, snapshot).value; } catch { value = undefined; }

        // Innermost map (ai === 0) honors the canvas-tracked selectedMapIndex so the preview
        // matches the cell the user clicked. Outer maps fall back to element 0 since
        // selectedMapIndex applies to the innermost iteration only.
        const isInnermost = ai === 0;
        const pickIdx = isInnermost && typeof selectedMapIndex === 'number' ? selectedMapIndex : 0;
        let resolved: Record<string, unknown> | undefined;
        if (Array.isArray(value) && value.length > 0) {
          const target = value[pickIdx] ?? value[0];
          if (target && typeof target === 'object' && !Array.isArray(target)) resolved = target as Record<string, unknown>;
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          resolved = value as Record<string, unknown>;
        }

        if (resolved) {
          if (contextItem) contextParentItem = contextItem;
          contextItem = resolved;
        }
      }
    }

    // Build globalContext from browser APIs
    const globalContext = typeof window !== 'undefined' ? {
      browser: {
        url: window.location.href,
        path: window.location.pathname,
        domain: window.location.hostname,
        baseUrl: window.location.origin,
        query: Object.fromEntries(new URLSearchParams(window.location.search)),
        breakpoint: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : window.innerWidth < 1280 ? 'laptop' : 'desktop',
        environment: process.env.NODE_ENV ?? 'development',
        theme: 'system',
      },
      screen: {
        width: window.innerWidth,
        height: window.innerHeight,
        scroll: { x: window.scrollX, y: window.scrollY, xPercent: 0, yPercent: 0 },
      },
    } : {};

    // Build pages from routes config
    type RouteEntry = { path: string; config: string; id?: string; auth?: boolean; dynamic?: boolean };
    const routes = (routesConfig as { routes?: RouteEntry[] }).routes ?? [];
    const pages = Object.fromEntries(
      routes.map(r => [r.id ?? r.config, { id: r.id ?? r.config, path: r.path, name: r.config, dynamic: r.dynamic ?? false, auth: r.auth ?? false }])
    );

    // Build theme from config — augment with radius map so theme?.['radius']?.['sm'] → 'rounded-sm'
    const RADIUS_MAP: Record<string, string> = {
      none: 'rounded-none', sm: 'rounded-sm', base: 'rounded',
      md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl',
      '2xl': 'rounded-2xl', '3xl': 'rounded-3xl', full: 'rounded-full',
    };
    const theme = { ...(themeConfig as Record<string, unknown>), radius: RADIUS_MAP };

    // Build context.workflow from persisted test results so formulas like
    // context.workflow['0'].result?.login?.errorCode evaluate correctly
    const workflowMap: Record<string, { result: unknown; error: unknown }> = {};
    for (const [key, entry] of Object.entries(currentWorkflowTestResults ?? {})) {
      workflowMap[key] = { result: entry.result, error: entry.error };
    }

    // Build parameters map from global workflow test values when editing a global workflow
    const parametersCtx: Record<string, unknown> = {};
    if (workflowCanvasTarget?.kind === 'globalWorkflow') {
      const wfParams = globalWorkflowMeta[workflowCanvasTarget.id]?.params ?? [];
      for (const p of wfParams) {
        parametersCtx[p.name] = p.testValue ?? undefined;
      }
    }
    // When editing a global formula body, inject formulaParams test values
    if (formulaParams && formulaParams.length > 0) {
      for (const p of formulaParams) {
        parametersCtx[p.name] = p.testValue ?? undefined;
      }
    }

    const hasParamsCtx = workflowCanvasTarget?.kind === 'globalWorkflow' || (formulaParams && formulaParams.length > 0);

    return {
      ...zustandData,
      ...vs,
      collections: collectionsMap,
      variables: vs,
      ...(hasParamsCtx ? { parameters: parametersCtx } : {}),
      // Build nested auth object from flat Zustand keys — mirrors how mergeDataPaths works in the engine.
      // Without this, auth?.['user'] always evaluates to undefined in the formula preview.
      auth: {
        user:         zustandData['auth.user'] ?? null,
        accessToken:  zustandData['auth.accessToken'] ?? zustandData['auth.token'] ?? null,
        refreshToken: zustandData['auth.refreshToken'] ?? null,
      },
      context: {
        ...(contextItem ? (() => {
          const innerIdx = typeof selectedMapIndex === 'number' ? selectedMapIndex : 0;
          const parentCtx = contextParentItem
            ? { data: { ...contextParentItem, index: 0, repeatIndex: 0, isACopy: false, parent: null, repeatedItems: [contextParentItem] } }
            : null;
          return {
            item: {
              ...contextItem,
              data: {
                ...contextItem,
                index: innerIdx,
                repeatIndex: innerIdx,
                isACopy: false,
                parent: parentCtx,
                repeatedItems: [contextItem],
              },
              index: innerIdx,
              repeatIndex: innerIdx,
              isACopy: false,
              parent: parentCtx,
              repeatedItems: [contextItem],
            },
            index: 0,
          };
        })() : {}),
        workflow: workflowMap,
        ...(scComponentContext ? { component: scComponentContext } : {}),
        ...(scLocalContext ? { local: scLocalContext } : {}),
      },
      globalContext,
      pages,
      theme,
    };
  }, [vsData, zustandData, selectedIds, selectedMapIndex, pageNodes, currentWorkflowTestResults, editingSharedComponentId, workflowCanvasTarget, globalWorkflowMeta]);

  // When a workflowTrigger is set, inject the trigger's event shape as preview context
  const contextWithEvent = useMemo(() => {
    if (!workflowTrigger) return context;
    const eventShape = EVENT_SHAPES[workflowTrigger] ?? {};
    return { ...context, event: eventShape };
  }, [context, workflowTrigger]);

  const evalResult = useMemo(() => {
    if (mode === 'js') {
      // Evaluate the JS body via the same evaluator pipeline ({ js } shape).
      return evaluateFormula({ js: jsCode } as object, contextWithEvent);
    }
    return evaluateFormula(formula, contextWithEvent);
  }, [mode, jsCode, formula, contextWithEvent]);

  const apply = useCallback(() => {
    if (mode === 'js') {
      const trimmed = jsCode.trim();
      if (!trimmed) {
        onChange('');
      } else {
        onChange({ js: jsCode } as unknown as FormulaValue);
      }
      onClose();
      return;
    }
    const el = editorRef.current;
    const formulaStr = el ? serializeEditor(el) : formula;
    onChange(formulaToStoredValue(formulaStr));
    onClose();
  }, [mode, jsCode, formula, onChange, onClose]);

  const unbind = useCallback(() => {
    onChange('');
    onClose();
  }, [onChange, onClose]);

  // ── History helpers ──────────────────────────────────────────────────────────

  /** Push a formula snapshot immediately (used after chip insert / delete / paste). */
  const pushHistory = useCallback((f: string) => {
    if (isUndoRedoRef.current) return;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    const hist = historyRef.current;
    const idx = historyIdxRef.current;
    const next = hist.slice(0, idx + 1);
    if (next[next.length - 1] === f) return; // no change — skip
    next.push(f);
    if (next.length > 200) next.shift();
    historyRef.current = next;
    historyIdxRef.current = next.length - 1;
  }, []);

  /** Push a formula snapshot after a short debounce (used on every keystroke). */
  const pushHistoryDebounced = useCallback((f: string) => {
    if (isUndoRedoRef.current) return;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => pushHistory(f), 400);
  }, [pushHistory]);

  /** Restore a formula snapshot (used by undo/redo). */
  const restoreFormula = useCallback((f: string) => {
    const el = editorRef.current;
    if (!el) return;
    isUndoRedoRef.current = true;
    populateEditor(el, f, dsMap, varMap, stepNameMap, scPropMap, scVarMap, scFormulaMap);
    setFormula(f);
    // Move cursor to end
    const r = document.createRange();
    r.selectNodeContents(el); r.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges(); sel?.addRange(r);
    isUndoRedoRef.current = false;
  }, [dsMap, varMap, stepNameMap, scPropMap, scVarMap, scFormulaMap]);

  // Restore the saved caret position before any programmatic insertion
  const restoreCaret = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const saved = savedRangeRef.current;
    if (saved && el.contains(saved.commonAncestorContainer)) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(saved);
    }
  }, []);

  // UUID → name maps for converting chip-style formula paths to JS identifier syntax
  // when in JavaScript mode. We strip the trailing label-style segments and use
  // the canonical labels stored in `varMap`/`dsMap`.
  const uuidToVarName = useMemo(() => {
    const m = new Map<string, string>();
    for (const [uuid, info] of varMap) m.set(uuid, info.label);
    return m;
  }, [varMap]);
  const uuidToCollectionName = useMemo(() => {
    const m = new Map<string, string>();
    for (const [uuid, info] of dsMap) m.set(uuid, info.label);
    return m;
  }, [dsMap]);

  // Insert a chip at the current caret position
  const insertChip = useCallback((formulaPath: string, displayLabel: string, type: 'collection' | 'variable' | 'context' | 'pages' | 'theme' | 'form' | 'error' | 'event' | 'shared-component' | 'parameter') => {
    if (mode === 'js') {
      // JavaScript mode: insert WeWeb-style identifier (variables.cartCount, etc.)
      // at the caret of the CodeMirror editor instead of a chip.
      const ident = buildIdentifierForJs(formulaPath, uuidToVarName, uuidToCollectionName);
      jsEditorRef.current?.insertAtCursor(ident);
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    restoreCaret();
    insertChipAtCaret(el, formulaPath, displayLabel, type);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [mode, uuidToVarName, uuidToCollectionName, restoreCaret, pushHistory]);

  // Insert plain text (operators, variable paths) at caret
  const insertAtCursor = useCallback((text: string) => {
    if (mode === 'js') {
      jsEditorRef.current?.insertAtCursor(text);
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    restoreCaret();
    insertPlainTextAtCaret(el, text);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [mode, restoreCaret, pushHistory]);

  // Insert a function as visual chips: [fnName] [(] [,]* [)]
  const insertFunction = useCallback((fnInsert: string, signature: string) => {
    if (mode === 'js') {
      jsEditorRef.current?.insertAtCursor(fnInsert);
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    restoreCaret();
    insertFunctionChipsAtCaret(el, fnInsert, signature);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [mode, restoreCaret, pushHistory]);

  // Insert a colored operator chip
  const insertOperatorChip = useCallback((label: string, insertValue: string, category: string) => {
    if (mode === 'js') {
      jsEditorRef.current?.insertAtCursor(insertValue);
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    restoreCaret();
    insertOperatorChipAtCaret(el, label, insertValue, category);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [mode, restoreCaret, pushHistory]);

  // Copy: serialize selected formula text (not display labels) to clipboard
  const handleCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.isCollapsed) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', serializeRangeFromEditor(el, sel));
  }, []);

  // Cut: serialize selection to clean formula string, delete selection, update state.
  // Without this the browser would put the raw HTML textContent (including \u200b
  // ZWS guards) into the clipboard, causing garbled output on paste-back.
  const handleCut = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.isCollapsed) return;
    e.preventDefault();
    // Put the clean formula string on the clipboard (same as copy)
    e.clipboardData.setData('text/plain', serializeRangeFromEditor(el, sel));
    // Delete the selected content
    sel.getRangeAt(0).deleteContents();
    normalizeEditorContent(el);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [pushHistory]);

  // Paste: parse pasted formula string and render as chips at caret
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const el = editorRef.current;
    if (!el) return;
    // Only restore the saved blur-range when the editor has no live selection.
    // If the user did Cmd+A (or drag-selected), the live selection is already
    // correct and restoreCaret() would overwrite it with the old collapsed range,
    // causing paste to insert at the old cursor instead of replacing the selection.
    const liveSel = window.getSelection();
    const hasLiveSelection = !!(
      liveSel?.rangeCount &&
      el.contains(liveSel.getRangeAt(0).commonAncestorContainer) &&
      !liveSel.getRangeAt(0).collapsed
    );
    if (hasLiveSelection) {
      el.focus();
    } else {
      restoreCaret();
    }
    insertPastedFormulaAtCaret(el, text, dsMap, varMap, stepNameMap);
    // Normalize after insert: remove any stray <br>/<div> and add ZWS chip guards
    normalizeEditorContent(el);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [dsMap, varMap, stepNameMap, restoreCaret, pushHistory]);

  const insertVar = useCallback((formulaPath: string, displayLabel: string, type: 'variable' | 'context' | 'pages' | 'theme' | 'form' | 'event' = 'variable') => {
    insertChip(formulaPath, displayLabel, type);
  }, [insertChip]);

  // Handle keydown for chip backspace/delete, Ctrl+Enter, and undo/redo
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); return; }

    // Undo / Redo
    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      // Cancel any pending debounce FIRST — if it fires after undo/redo it would
      // push a stale entry at the wrong index, advance historyIdxRef, and make
      // redo impossible (idx would already equal length-1).
      if (historyTimerRef.current) { clearTimeout(historyTimerRef.current); historyTimerRef.current = null; }
      if (e.shiftKey) {
        // Redo
        const idx = historyIdxRef.current;
        if (idx < historyRef.current.length - 1) {
          historyIdxRef.current = idx + 1;
          restoreFormula(historyRef.current[historyIdxRef.current]);
        }
      } else {
        // Undo
        const idx = historyIdxRef.current;
        if (idx > 0) {
          historyIdxRef.current = idx - 1;
          restoreFormula(historyRef.current[historyIdxRef.current]);
        }
      }
      return;
    }

    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const isCollapsed = range.collapsed;

    if (isCollapsed && e.key === 'Backspace') {
      // If caret is right after a chip span, remove it
      const { startContainer, startOffset } = range;
      let chipToRemove: HTMLElement | null = null;

      if (startContainer === editorRef.current) {
        // Caret is directly in the editor div
        const prev = editorRef.current.childNodes[startOffset - 1];
        if (prev instanceof HTMLElement && prev.dataset.formula) chipToRemove = prev;
      } else if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
        // At the start of a text node — check previous sibling
        const prev = startContainer.previousSibling;
        if (prev instanceof HTMLElement && prev.dataset.formula) chipToRemove = prev;
      }

      if (chipToRemove) {
        e.preventDefault();
        chipToRemove.remove();
        const f = serializeEditor(editorRef.current!); setFormula(f); pushHistory(f);
        return;
      }
    }

    if (isCollapsed && e.key === 'Delete') {
      const { startContainer, startOffset } = range;
      let chipToRemove: HTMLElement | null = null;

      if (startContainer === editorRef.current) {
        const next = editorRef.current.childNodes[startOffset];
        if (next instanceof HTMLElement && next.dataset.formula) chipToRemove = next;
      } else if (startContainer.nodeType === Node.TEXT_NODE) {
        if (startOffset === startContainer.textContent!.length) {
          const next = startContainer.nextSibling;
          if (next instanceof HTMLElement && next.dataset.formula) chipToRemove = next;
        }
      }

      if (chipToRemove) {
        e.preventDefault();
        chipToRemove.remove();
        const f = serializeEditor(editorRef.current!); setFormula(f); pushHistory(f);
        return;
      }
    }

    // Arrow keys: skip over chip spans atomically
    if (isCollapsed && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const { startContainer, startOffset } = range;

      if (e.key === 'ArrowLeft') {
        let prev: Node | null = null;
        if (startContainer === editorRef.current) {
          prev = editorRef.current.childNodes[startOffset - 1] ?? null;
        } else if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
          prev = startContainer.previousSibling;
        }
        if (prev instanceof HTMLElement && prev.dataset.formula) {
          e.preventDefault();
          const r = document.createRange();
          r.setStartBefore(prev); r.collapse(true);
          sel.removeAllRanges(); sel.addRange(r);
          return;
        }
      } else {
        let next: Node | null = null;
        if (startContainer === editorRef.current) {
          next = editorRef.current.childNodes[startOffset] ?? null;
        } else if (startContainer.nodeType === Node.TEXT_NODE) {
          if (startOffset === startContainer.textContent!.length) next = startContainer.nextSibling;
        }
        if (next instanceof HTMLElement && next.dataset.formula) {
          e.preventDefault();
          const r = document.createRange();
          r.setStartAfter(next); r.collapse(true);
          sel.removeAllRanges(); sel.addRange(r);
          return;
        }
      }
    }
  }, [apply, pushHistory, restoreFormula]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const previewColor = evalResult.error
    ? '#f87171'
    : evalResult.value === undefined
      ? '#6b7280'
      : typeof evalResult.value === 'boolean'
        ? (evalResult.value ? '#86efac' : '#f87171')
        : '#86efac';

  const PANEL_W = 360;
  const posStyle: React.CSSProperties = anchorRight !== undefined
    ? { right: anchorRight }
    : anchorLeft !== undefined
      ? { left: anchorLeft }
      : anchor === 'right'
        ? { right: 260 }
        : { left: 248 };

  return createPortal(
    <div
      ref={panelRef}
      data-testid="formula-editor"
      style={{
        position: 'fixed',
        top: 52,
        ...posStyle,
        width: PANEL_W,
        height: 'calc(100vh - 64px)',
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        zIndex: 100020,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#f3f4f6', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {/* Formula | JavaScript mode toggle — hidden when locked into JS mode
            (e.g. from the runJavaScript workflow step config). */}
        {!lockToJs && (
          <select
            data-testid="formula-mode-select"
            value={mode}
            onChange={(e) => {
              const next = e.target.value as 'formula' | 'js';
              if (next === 'js' && mode === 'formula') {
                // Best-effort migration: seed JS body with `return <formula>;` so
                // the user has something runnable. Lossy if the formula uses
                // chip-only syntax (UUIDs); user will fix up identifiers via tabs.
                const seed = formula.trim();
                if (seed && !jsCode) setJsCode(`return ${seed};`);
              }
              setMode(next);
            }}
            style={{
              fontSize: 10, padding: '1px 6px', background: '#1f2937', color: '#e5e7eb',
              border: '1px solid #374151', borderRadius: 3, cursor: 'pointer', flexShrink: 0,
            }}
          >
            <option value="formula">Formula</option>
            <option value="js">JavaScript</option>
          </select>
        )}
        {!hideUnbind && (
          <button onClick={unbind} data-testid="formula-unbind"
            style={{ padding: '1px 6px', background: '#1f2937', border: '1px solid #374151', borderRadius: 3, color: '#9ca3af', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>
            Unbind
          </button>
        )}
        <button onClick={onClose} data-testid="formula-close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14, lineHeight: 1, padding: '1px' }}>×</button>
      </div>

      {/* ── Formula / JavaScript input ── */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {mode === 'js' ? 'JavaScript' : 'Formula'}
        </div>
        {mode === 'js' ? (
          <JavaScriptEditor
            ref={jsEditorRef}
            value={jsCode}
            onChange={setJsCode}
            placeholder={"// Write JavaScript that returns a value.\n// Available: variables.<name>, collections.<name>.data, context.item, parameters\nreturn variables.cartCount > 0;"}
            minHeight={120}
            maxHeight={260}
            testId="formula-js-input"
          />
        ) : (
        <div style={{
          background: '#0f172a',
          border: `1px solid ${isFocused ? '#818cf8' : '#374151'}`,
          borderRadius: 5,
          minHeight: 52,
          transition: 'border-color 0.1s',
          position: 'relative',
        }}>
          {/* Placeholder */}
          {!formula && (
            <div
              aria-hidden
              style={{
                position: 'absolute', top: 5, left: 8, right: 8,
                fontSize: 11, color: '#4b5563', fontFamily: '"JetBrains Mono","Fira Mono",monospace',
                pointerEvents: 'none', lineHeight: 1.5,
              }}
            >
              variables['UUID'] &gt;= 60  ·  if(x, a, b)  ·  length(arr)
            </div>
          )}
          <div
            ref={editorRef}
            data-testid="formula-input"
            contentEditable
            suppressContentEditableWarning
            onInput={() => {
              const el = editorRef.current;
              if (!el) return;
              // Remove stray <br>/<div> blocks the browser inserts when backspacing
              // adjacent to a non-editable chip, then ensure ZWS guards between chips
              normalizeEditorContent(el);
              // Auto-chip any operator tokens the user typed (e.g. (, ), ,, ||, &&, ===, !==)
              const wasChipped = rechipCurrentTextNode(el);
              const f = serializeEditor(el);
              setFormula(f);
              // Each auto-chipped token is its own undo step (immediate push).
              // Regular keystrokes are debounced so they group into one undo step.
              if (wasChipped) pushHistory(f); else pushHistoryDebounced(f);
            }}
            onKeyDown={handleKeyDown}
            onCopy={handleCopy}
            onCut={handleCut}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setIsFocused(false);
              const sel = window.getSelection();
              if (sel?.rangeCount) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
            }}
            spellCheck={false}
            style={{
              display: 'block',
              minHeight: 52,
              padding: '5px 8px',
              fontSize: 11,
              fontFamily: '"JetBrains Mono","Fira Mono","Cascadia Code",monospace',
              lineHeight: 1.6,
              color: '#f3f4f6',
              outline: 'none',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          />
        </div>
        )}
      </div>

      {/* ── Current value + Expected format ── */}
      <div style={{ padding: '4px 10px 6px', borderBottom: '1px solid #1f2937', flexShrink: 0, background: '#0d1420', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Row 1 — Current value (full width) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current value</span>
          <div style={{ width: '100%' }} data-testid="formula-current-value">
          {evalResult.error ? (
              <div style={{ fontSize: 10, color: '#f87171', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.4, background: '#1a0a0a', border: '1px solid #3f1515', borderRadius: 4, padding: '3px 6px' }}>
              {evalResult.error}
              </div>
          ) : evalResult.value === undefined ? (
              <div style={{ fontSize: 10, color: '#4b5563', fontFamily: 'monospace', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '3px 6px' }}>—</div>
          ) : (() => {
            let displayVal = evalResult.value;
            if (typeof displayVal === 'string') {
              try { displayVal = JSON.parse(displayVal); } catch { /* not JSON */ }
            }
            if (displayVal !== null && typeof displayVal === 'object') {
              const pretty = JSON.stringify(displayVal, null, 2);
              return (
                <pre
                    style={{ margin: 0, width: '100%', boxSizing: 'border-box', fontSize: 9, fontFamily: '"JetBrains Mono","Fira Mono",monospace', background: '#0f172a', border: '1px solid #1e293b', padding: '3px 6px', borderRadius: 4, maxHeight: 80, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{ __html: highlightJson(pretty) }}
                />
              );
            }
            return (
                <div style={{ fontSize: 10, color: previewColor, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.4, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '3px 6px' }}>
                {String(displayVal)}
                </div>
            );
          })()}
        </div>
        </div>
        {/* Row 2 — Expected format (full width, only when set) */}
        {(hint || expectedType !== 'any') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Expected</span>
            <Tooltip text={hint ? `${hint}\n\nReturn type: ${expectedType}` : `Expected return type: ${expectedType}`}>
              <span style={{
                  border: '1px solid #374151', borderRadius: '50%',
                  width: 11, height: 11, fontSize: 7, flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: '#6b7280', cursor: 'default',
              }}>?</span>
            </Tooltip>
            </div>
            <div style={{ fontSize: 10, color: '#fbbf24', fontFamily: 'monospace', wordBreak: 'break-all', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '3px 6px' }}>
              {hint || expectedType}
            </div>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {([
          ...((showQuickTab && !serverContext) || (paramsInQuick && hasFormulaParams) ? [{ id: 'quick' as Tab, icon: '⚡', label: 'Quick' }] : []),
          ...(!serverContext ? [{ id: 'variables' as Tab, icon: '{x}', label: 'Variables' }] : []),
          ...(!serverContext ? [{ id: 'data' as Tab, icon: '≡', label: 'Data' }] : []),
          { id: 'formulas' as Tab, icon: 'ƒ', label: 'Formulas' },
          { id: 'auth' as Tab, icon: '🔐', label: 'Auth' },
          ...(showWorkflowTab ? [{ id: 'workflow' as Tab, icon: '▶', label: 'Workflow' }] : []),
        ]).map(t => (
          <button key={t.id} data-testid={`formula-tab-${t.id}`} onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '5px 4px', background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid #818cf8' : '2px solid transparent',
              color: tab === t.id ? '#818cf8' : '#6b7280',
              fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            }}>
            <span style={{ fontFamily: 'monospace', fontSize: 9 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Search ── */}
      <div style={{ padding: '4px 10px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder='Search variables…'
          style={{
            width: '100%', boxSizing: 'border-box', background: '#1f2937',
            border: '1px solid #374151', borderRadius: 3, color: '#d1d5db',
            fontSize: 10, padding: '3px 7px', outline: 'none',
          }}
        />
      </div>

      {/* ── Tab Body ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        {tab === 'variables' && (
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <PageComponentsSection onInsert={insertChip} search={search} />
            <VariableTree
              onSelect={insertVar}
              search={search}
              isInsideRepeat={isInsideRepeat}
              customVars={[
                ...customVars,
                // Virtual entries for each controlled Input node on the page
                ...controlledInputVarEntries.map(e => ({
                  id: e.id,
                  label: e.label,
                  name: e.label,
                  type: 'string' as const,
                  folderId: 'Page Inputs',
                })),
              ]}
              varFolders={[
                ...varFolders,
                // Ensure the "Page Inputs" folder appears in the tree
                ...(controlledInputVarEntries.length > 0 ? [{ id: 'Page Inputs', name: 'Page Inputs' }] : []),
              ]}
            />
          </div>
        )}
        {tab === 'data' && (
          <CollectionsDataTab onInsert={insertChip} search={search} />
        )}
        {tab === 'formulas' && (
          <FunctionLibrary
            onInsert={insertAtCursor}
            onInsertFn={insertFunction}
            search={search}
            globalFormulas={globalFormulas ?? {}}
          />
        )}
        {tab === 'quick' && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* Formula params in Quick tab when paramsInQuick is set */}
            {paramsInQuick && hasFormulaParams && formulaParams && formulaParams.length > 0 && (
              <ParametersSection
                params={formulaParams}
                onInsert={insertChip}
              />
            )}
            {isInsideSharedComponent && (
              <SharedComponentContextSection onInsert={insertChip} overrideModelId={sharedAncestorModelId} />
            )}
            {isInsideForm && (
              <FormLocalSection onInsert={insertChip} pageFormFields={pageFormFields} nearestFormContainerId={nearestFormContainerId} />
            )}
            {isInsideRepeat && (
              <>
                <div style={{ padding: '8px 12px 4px', fontSize: 10, color: '#6b7280', fontStyle: 'italic' }}>
                  Fields from the repeated item
                </div>
                <ItemContextGroup onInsert={insertChip} initialOpen={true} />
              </>
            )}
          </div>
        )}
        {tab === 'auth' && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <AuthDataSection onInsert={insertChip} />
          </div>
        )}
        {tab === 'workflow' && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* Parameters section — shown when editing a global formula body (formulaParams prop) */}
            {hasFormulaParams && !paramsInQuick && formulaParams && formulaParams.length > 0 && (
              <ParametersSection
                params={formulaParams}
                onInsert={insertChip}
              />
            )}
            {/* Parameters section — shown when editing a global workflow that has declared params */}
            {!hasFormulaParams && globalWorkflowParams.length > 0 && (
              <ParametersSection
                params={globalWorkflowParams}
                onInsert={insertChip}
              />
            )}
            {/* Event context section — shown when trigger has an event shape */}
            {hasEventContext && workflowTrigger && (
              <EventContextSection
                trigger={workflowTrigger}
                onInsert={insertChip}
              />
            )}
            {/* Previous action test results */}
            {Object.keys(currentWorkflowTestResults ?? {}).length > 0 && (
              <WorkflowResultsTab
                testResults={currentWorkflowTestResults ?? {}}
                stepNameMap={stepNameMap}
                onSelect={(stepId, path, _actionIndex, source) => {
                  const base = source === 'error' ? 'error' : 'result';
                  const formulaPath = `context.workflow['${stepId}']${path ? `.${base}?.${path}` : `.${base}`}`;
                  // Always use the live stepNameMap label (reflects current canvas name/index)
                  const actionLabel = stepNameMap.get(stepId) || stepId;
                  const displayLabel = path
                    ? `${actionLabel}.${base}.${path}`
                    : `${actionLabel}.${base}`;
                  insertChip(formulaPath, displayLabel, source === 'error' ? 'error' : 'collection');
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Operators bar ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '4px 8px', borderTop: '1px solid #1f2937', flexShrink: 0, background: '#0f172a' }}>
        {OPERATORS.map(op => {
          const s = OP_STYLE[op.category];
          return (
          <Tooltip key={op.label} text={op.description}>
            <button
                onClick={() => insertOperatorChip(op.label, op.insert, op.category)}
              style={{
                  padding: '2px 2px',
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  borderRadius: 5,
                  cursor: 'pointer',
                  color: s.color,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  lineHeight: 1.4,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={ev => { ev.currentTarget.style.background = s.hoverBg; }}
                onMouseLeave={ev => { ev.currentTarget.style.background = s.bg; }}
            >
              {op.label}
            </button>
          </Tooltip>
          );
        })}
      </div>

      {/* ── Apply footer ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '5px 10px', borderTop: '1px solid #1f2937', flexShrink: 0 }}>
        <button onClick={onClose}
          style={{ padding: '3px 10px', background: 'transparent', border: '1px solid #374151', borderRadius: 4, color: '#6b7280', fontSize: 10, cursor: 'pointer' }}>
          Cancel
        </button>
        <button data-testid="formula-apply" onClick={apply}
          style={{ padding: '3px 12px', background: '#7c3aed', border: 'none', borderRadius: 4, color: '#fff', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>
          Apply
        </button>
      </div>
    </div>,
    document.body
  );
}
