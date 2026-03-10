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
 *   Tabs:     {x} Variables  |  ≡ Data  |  ƒ Formulas
 *   Body:     Searchable collapsible function categories or variable tree
 *   Footer:   Operators bar  =  !=  and  or  +  -  *
 */

import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { useBuilderStore, findNode, findParentNode, type DataSourceConfig } from './_store';

// ─── Tab content components (extracted to _formula-editor-tabs.tsx) ───────────
export { Tooltip, VariableTree, CollectionEntry, DataTreeNode, FunctionLibrary, FnRow,
  ContextDataSection, PagesDataSection, ColorsDataSection, TypographyDataSection,
  BorderRadiusDataSection, CollectionsDataTab, PageComponentsSection,
  type VarRowItem } from './_formula-editor-tabs';
import {
  Tooltip, VariableTree, CollectionEntry, FunctionLibrary,
  CollectionsDataTab, PageComponentsSection, FormLocalSection, ItemContextGroup,
  DataTreeNode, FEChevron,
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
  KNOWN_FN_NAMES, FN_NAME_RE, FN_NAME_SUFFIX_RE,
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
} from './_formula-editor-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'variables' | 'data' | 'formulas' | 'quick' | 'workflow';

export interface FormulaEditorProps {
  label: string;
  value: FormulaValue;
  onChange: (v: FormulaValue) => void;
  onClose: () => void;
  expectedType?: 'string' | 'number' | 'boolean' | 'any';
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
  onSelect,
}: {
  testResults: Record<string, WorkflowTestEntry>;
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
          actionIndex={idx + 1}
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
  stepId, entry, actionIndex, onSelect,
}: {
  stepId: string;
  entry: WorkflowTestEntry;
  actionIndex: number;
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
    onSelect(stepId, subPath, actionIndex, 'result');
  };
  const handleErrorInsert = (rawPath: string) => {
    const subPath = rawPath === 'error' ? '' : rawPath.replace(/^error\./, '');
    onSelect(stepId, subPath, actionIndex, 'error');
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
        <span style={{ fontSize: 11 }}>{entry.actionName || `Action ${actionIndex}`}</span>
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

export function FormulaEditor({ label, value, onChange, onClose, expectedType = 'any', hint, anchor = 'left', anchorLeft, anchorRight, hideUnbind }: FormulaEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  // Undo/redo history
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { globalFormulas, pageDataSources, customVars, varFolders, workflowTestResults } = useBuilderStore();
  const selectedIds = useBuilderStore(s => s.selectedIds);
  const pageNodes = useBuilderStore(s => s.pageNodes);
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

  // Detect if the selected node is a FormContainer or has one as an ancestor
  const isInsideForm = useMemo(() => {
    const id = selectedIds[0];
    if (!id) return false;
    // Check the selected node itself first (e.g. FormContainer is directly selected for workflow editing)
    const selfNode = findNode(pageNodes, id);
    if ((selfNode as { type?: string })?.type === 'FormContainer') return true;
    let node = findParentNode(pageNodes, id);
    while (node) {
      if ((node as { type?: string }).type === 'FormContainer') return true;
      const parent = findParentNode(pageNodes, node.id ?? '');
      node = parent ?? null;
    }
    return false;
  }, [selectedIds, pageNodes]);
  // Subscribe to live Zustand data so context stays fresh
  const zustandData = useSduiStore(s => s.data);

  // Derive initial formula string from stored value
  const initialFormula = useMemo(() => {
    const raw = storedValueToFormula(value);
    // When editing a formula/expression (non-string expected type, or hideUnbind which flags
    // formula-only contexts like validation), never JSON.stringify — that wraps the expression
    // in quotes, making it a string literal instead of a boolean/expression.
    if (expectedType !== 'string' || hideUnbind) return raw;
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
  const [tab, setTab] = useState<Tab>('variables');
  const [search, setSearch] = useState('');

  // Switch to Quick when entering a repeat or form; fall back to Variables when leaving
  useEffect(() => {
    if (isInsideRepeat || isInsideForm) setTab('quick');
    else if (tab === 'quick') setTab('variables');
  }, [isInsideRepeat, isInsideForm]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Map UUID → label for variable chip display
  const varMap = useMemo(
    () => new Map(
      customVars
        .filter(v => v.id)
        .map(v => [v.id!, { label: v.label ?? v.name ?? v.id! }])
    ),
    [customVars]
  );

  // Populate the editor on mount with the initial formula and seed history
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    populateEditor(el, initialFormula, dsMap, varMap);
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

  // Build context for evaluation — includes context.item from repeat ancestor, globalContext, pages, theme
  const context = useMemo(() => {
    const vs = getGlobalVariableStore().getState().getFullState() as Record<string, unknown>;
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

    // Resolve context.item from the selected node's nearest repeat ancestor
    let contextItem: Record<string, unknown> | undefined;
    const selectedId = selectedIds[0];
    if (selectedId) {
      let node = findNode(pageNodes, selectedId);
      while (node) {
        if (node.map) {
          // map is like "collections.UUID.data.search.items" or a variable store path
          const mapPath = node.map as string;
          const parts = mapPath.split('.');
          // Try progressively longer flat key prefixes in zustandData
          for (let i = 1; i <= parts.length; i++) {
            const flatKey = parts.slice(0, i).join('.');
            const flatVal = zustandData[flatKey];
            if (flatVal !== undefined) {
              // Navigate remaining path segments
              let val: unknown = flatVal;
              for (let j = i; j < parts.length; j++) {
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                  val = (val as Record<string, unknown>)[parts[j]];
                } else { val = undefined; break; }
              }
              if (Array.isArray(val) && val.length > 0) { contextItem = val[0] as Record<string, unknown>; }
              else if (val && typeof val === 'object' && !Array.isArray(val)) { contextItem = val as Record<string, unknown>; }
              break;
            }
          }
          break;
        }
        const parent = findParentNode(pageNodes, node.id ?? '');
        node = parent ?? null;
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
        breakpoint: window.innerWidth < 640 ? 'xs' : window.innerWidth < 768 ? 'sm' : window.innerWidth < 1024 ? 'md' : window.innerWidth < 1280 ? 'lg' : 'xl',
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
    for (const [key, entry] of Object.entries(workflowTestResults ?? {})) {
      workflowMap[key] = { result: entry.result, error: entry.error };
    }

    return {
      ...zustandData,
      ...vs,
      collections: collectionsMap,
      variables: vs,
      context: contextItem ? {
        item: {
          ...contextItem,
          data: {
            ...contextItem,
            index: 0,
            repeatIndex: 0,
            isACopy: false,
            parent: null,
            repeatedItems: [contextItem],
          },
          index: 0,
          repeatIndex: 0,
          isACopy: false,
          parent: null,
          repeatedItems: [contextItem],
        },
        index: 0,
        workflow: workflowMap,
      } : { workflow: workflowMap },
      globalContext,
      pages,
      theme,
    };
  }, [zustandData, selectedIds, pageNodes, workflowTestResults]);

  const evalResult = useMemo(() => evaluateFormula(formula, context), [formula, context]);

  const apply = useCallback(() => {
    const el = editorRef.current;
    const formulaStr = el ? serializeEditor(el) : formula;
    onChange(formulaToStoredValue(formulaStr));
    onClose();
  }, [formula, onChange, onClose]);

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
    populateEditor(el, f, dsMap, varMap);
    setFormula(f);
    // Move cursor to end
    const r = document.createRange();
    r.selectNodeContents(el); r.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges(); sel?.addRange(r);
    isUndoRedoRef.current = false;
  }, [dsMap]);

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

  // Insert a chip at the current caret position
  const insertChip = useCallback((formulaPath: string, displayLabel: string, type: 'collection' | 'variable' | 'context' | 'pages' | 'theme' | 'form' | 'error') => {
    const el = editorRef.current;
    if (!el) return;
    restoreCaret();
    insertChipAtCaret(el, formulaPath, displayLabel, type);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [restoreCaret, pushHistory]);

  // Insert plain text (operators, variable paths) at caret
  const insertAtCursor = useCallback((text: string) => {
    const el = editorRef.current;
    if (!el) return;
    restoreCaret();
    insertPlainTextAtCaret(el, text);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [restoreCaret, pushHistory]);

  // Insert a function as visual chips: [fnName] [(] [,]* [)]
  const insertFunction = useCallback((fnInsert: string, signature: string) => {
    const el = editorRef.current;
    if (!el) return;
    restoreCaret();
    insertFunctionChipsAtCaret(el, fnInsert, signature);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [restoreCaret, pushHistory]);

  // Insert a colored operator chip
  const insertOperatorChip = useCallback((label: string, insertValue: string, category: string) => {
    const el = editorRef.current;
    if (!el) return;
    restoreCaret();
    insertOperatorChipAtCaret(el, label, insertValue, category);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [restoreCaret, pushHistory]);

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
    insertPastedFormulaAtCaret(el, text, dsMap, varMap);
    // Normalize after insert: remove any stray <br>/<div> and add ZWS chip guards
    normalizeEditorContent(el);
    const f = serializeEditor(el); setFormula(f); pushHistory(f);
  }, [dsMap, restoreCaret, pushHistory]);

  const insertVar = useCallback((formulaPath: string, displayLabel: string, type: 'variable' | 'context' | 'pages' | 'theme' | 'form' = 'variable') => {
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
        {!hideUnbind && (
          <button onClick={unbind} data-testid="formula-unbind"
            style={{ padding: '1px 6px', background: '#1f2937', border: '1px solid #374151', borderRadius: 3, color: '#9ca3af', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>
            Unbind
          </button>
        )}
        <button onClick={onClose} data-testid="formula-close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14, lineHeight: 1, padding: '1px' }}>×</button>
      </div>

      {/* ── Formula input — contenteditable ── */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Formula</div>
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
              Type a formula or click below…
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
      </div>

      {/* ── Current value + Expected format ── */}
      <div style={{ padding: '4px 10px 6px', borderBottom: '1px solid #1f2937', flexShrink: 0, background: '#0d1420', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Row 1 — Current value (full width) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current value</span>
          <div style={{ width: '100%' }}>
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
          ...((isInsideRepeat || isInsideForm) ? [{ id: 'quick' as Tab, icon: '⚡', label: 'Quick' }] : []),
          { id: 'variables' as Tab, icon: '{x}', label: 'Variables' },
          { id: 'data' as Tab, icon: '≡', label: 'Data' },
          { id: 'formulas' as Tab, icon: 'ƒ', label: 'Formulas' },
          ...(Object.keys(workflowTestResults ?? {}).length > 0 ? [{ id: 'workflow' as Tab, icon: '▶', label: 'Workflow' }] : []),
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
          placeholder={tab === 'formulas' ? 'Search functions…' : 'Search variables…'}
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
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <PageComponentsSection onInsert={insertChip} search={search} />
            <VariableTree
              onSelect={insertVar}
              search={search}
              customVars={customVars}
              varFolders={varFolders}
            />
          </div>
        )}
        {tab === 'data' && (
          <CollectionsDataTab onInsert={insertChip} search={search} />
        )}
        {tab === 'formulas' && (
          <FunctionLibrary onInsert={insertAtCursor} onInsertFn={insertFunction} search={search} globalFormulas={globalFormulas} />
        )}
        {tab === 'quick' && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {isInsideForm && (
              <FormLocalSection onInsert={insertChip} />
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
        {tab === 'workflow' && (
          <WorkflowResultsTab
            testResults={workflowTestResults ?? {}}
            onSelect={(stepId, path, _actionIndex, source) => {
              const base = source === 'error' ? 'error' : 'result';
              const formulaPath = `context.workflow['${stepId}']${path ? `.${base}?.${path}` : `.${base}`}`;
              // Use the stored action name (e.g. "Login") instead of a numeric index
              const actionLabel = (workflowTestResults ?? {})[stepId]?.actionName || 'Action';
              const displayLabel = path
                ? `${actionLabel}.${base}.${path}`
                : `${actionLabel}.${base}`;
              insertChip(formulaPath, displayLabel, source === 'error' ? 'error' : 'collection');
            }}
          />
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
