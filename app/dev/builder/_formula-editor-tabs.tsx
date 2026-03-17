'use client';

/**
 * _formula-editor-tabs.tsx
 *
 * Tab content components for the formula editor.
 * Extracted from _formula-editor.tsx.
 *
 * Exports:
 *  - Tooltip
 *  - VarRowItem (interface)
 *  - VariableEntry, VariableTree, PageComponentsSection
 *  - CollectionEntry, DataTreeNode
 *  - ContextDataSection, PagesDataSection, ColorsDataSection
 *  - TypographyDataSection, BorderRadiusDataSection, CollectionsDataTab
 *  - FunctionLibrary, FnRow
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useBuilderStore, findNode, findParentNode, type DataSourceConfig, type CustomVar, type SDUINode } from './_store';
import { getPopups } from '@/lib/builder/popup-data';
import { useSduiStore } from '@/store/sdui-store';
import { getGlobalVariableStore } from '@/lib/sdui/global-variable-store';
import routesConfig from '@/config/routes.json';
import themeConfig from '@/config/theme.json';
import {
  type FnDef,
  FUNCTION_LIBRARY,
  buildFormulaPath,
  buildDisplayLabel,
  buildChipSpan,
  insertChipAtCaret,
  CHIP_RE,
  pathToFormulaAndDisplay,
} from './_formula-editor-dom';
import { STANDALONE_VARIABLE_TYPES } from '@/lib/sdui/controlled-component-registry';

// ─── Tooltip ──────────────────────────────────────────────────────────────────

export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const show = (rect: DOMRect | null) => setRect(rect);
  const hide = () => setRect(null);

  // Compute fixed position so the tooltip never clips viewport edges
  const tipStyle = (): React.CSSProperties => {
    if (!rect) return { display: 'none' };
    const TIP_W = 220;
    const MARGIN = 8;
    // Horizontal: center on anchor, clamp within viewport
    let left = rect.left + rect.width / 2 - TIP_W / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - TIP_W - MARGIN));
    // Vertical: prefer above, fall back to below
    const top = rect.top > 80 ? undefined : rect.bottom + 6;
    const bottom = rect.top > 80 ? window.innerHeight - rect.top + 6 : undefined;
    return {
      position: 'fixed',
      left,
      ...(top !== undefined ? { top } : { bottom }),
      width: TIP_W,
      background: '#1e293b', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px',
      fontSize: 11, color: '#d1d5db', whiteSpace: 'pre-wrap',
      zIndex: 100030, boxShadow: '0 4px 16px rgba(0,0,0,0.6)', pointerEvents: 'none',
      lineHeight: 1.5,
    };
  };

  return (
    <span
      ref={anchorRef}
      style={{ display: 'inline-flex' }}
      onMouseEnter={() => show(anchorRef.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={hide}
    >
      {children}
      {rect && createPortal(
        <span style={tipStyle()}>{text}</span>,
        document.body
      )}
    </span>
  );
}

// ─── Variable Tree ────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  string: '#86efac', number: '#fde68a', boolean: '#c4b5fd',
  array: '#67e8f9', object: '#f9a8d4', unknown: '#9ca3af', form: '#fb923c',
};

const TYPE_BADGE_COLOR: Record<string, string> = {
  string: '#14532d', number: '#78350f', boolean: '#4c1d95',
  array: '#164e63', object: '#701a75', unknown: '#374151', form: '#7c2d12',
};

/** Row item in the Variables section. */
export interface VarRowItem {
  formulaPath: string;
  displayLabel: string;
  type: 'variable' | 'context' | 'pages' | 'theme' | 'form' | 'event' | 'popup';
  typeName: string;
  /** Sub-items for expandable types (form fields, object keys, etc.) */
  children?: VarRowItem[];
  /** For theme color items: hex color value for the swatch */
  _colorValue?: string;
}

/** Pages variables built from config/routes.json */
const PAGES_VARS: VarRowItem[] = (() => {
  type RouteEntry = { path: string; config: string; id?: string; auth?: boolean; dynamic?: boolean };
  const routes = (routesConfig as { routes?: RouteEntry[] }).routes ?? [];
  return routes.map(r => {
    const key = r.id ?? r.config;
    return {
      formulaPath: `pages['${key}']`,
      displayLabel: r.config,
      type: 'pages' as const,
      typeName: 'object',
      children: [
        { formulaPath: `pages['${key}']?.['id']`, displayLabel: `${r.config}.id`, type: 'pages' as const, typeName: 'string' },
        { formulaPath: `pages['${key}']?.['path']`, displayLabel: `${r.config}.path`, type: 'pages' as const, typeName: 'string' },
        { formulaPath: `pages['${key}']?.['name']`, displayLabel: `${r.config}.name`, type: 'pages' as const, typeName: 'string' },
        { formulaPath: `pages['${key}']?.['dynamic']`, displayLabel: `${r.config}.dynamic`, type: 'pages' as const, typeName: 'boolean' },
        { formulaPath: `pages['${key}']?.['auth']`, displayLabel: `${r.config}.auth`, type: 'pages' as const, typeName: 'boolean' },
      ] as VarRowItem[],
    };
  });
})();

/** Theme variables built from config/theme.json */
const THEME_VARS: VarRowItem[] = (() => {
  const items: VarRowItem[] = [];
  const tc = themeConfig as Record<string, unknown>;
  // Colors
  if (tc.colors && typeof tc.colors === 'object') {
    const colorItems: VarRowItem[] = Object.entries(tc.colors as Record<string, string>).map(([k, v]) => ({
      formulaPath: `theme?.['colors']?.['${k}']`,
      displayLabel: `colors.${k}`,
      type: 'theme' as const,
      typeName: 'string',
      _colorValue: v,
    } as VarRowItem & { _colorValue?: string }));
    items.push({
      formulaPath: `theme?.['colors']`,
      displayLabel: 'colors',
      type: 'theme' as const,
      typeName: 'object',
      children: colorItems,
    });
  }
  // Sections
  if (tc.sections && typeof tc.sections === 'object') {
    const sectionItems: VarRowItem[] = Object.keys(tc.sections as object).map(k => ({
      formulaPath: `theme?.['sections']?.['${k}']`,
      displayLabel: `sections.${k}`,
      type: 'theme' as const,
      typeName: 'object',
    }));
    items.push({
      formulaPath: `theme?.['sections']`,
      displayLabel: 'sections',
      type: 'theme' as const,
      typeName: 'object',
      children: sectionItems,
    });
  }
  // Fonts
  if (tc.fonts && typeof tc.fonts === 'object') {
    const fontItems: VarRowItem[] = Object.keys(tc.fonts as object).map(k => ({
      formulaPath: `theme?.['fonts']?.['${k}']`,
      displayLabel: `fonts.${k}`,
      type: 'theme' as const,
      typeName: 'string',
    }));
    items.push({
      formulaPath: `theme?.['fonts']`,
      displayLabel: 'fonts',
      type: 'theme' as const,
      typeName: 'object',
      children: fontItems,
    });
  }
  return items;
})();

/** Context variables that are always available */
const CONTEXT_VARS: VarRowItem[] = [
  // Browser context
  { formulaPath: "globalContext?.['browser']?.['url']", displayLabel: 'browser.url', type: 'context', typeName: 'string' },
  { formulaPath: "globalContext?.['browser']?.['path']", displayLabel: 'browser.path', type: 'context', typeName: 'string' },
  { formulaPath: "globalContext?.['browser']?.['domain']", displayLabel: 'browser.domain', type: 'context', typeName: 'string' },
  { formulaPath: "globalContext?.['browser']?.['baseUrl']", displayLabel: 'browser.baseUrl', type: 'context', typeName: 'string' },
  { formulaPath: "globalContext?.['browser']?.['query']", displayLabel: 'browser.query', type: 'context', typeName: 'object' },
  { formulaPath: "globalContext?.['browser']?.['breakpoint']", displayLabel: 'browser.breakpoint', type: 'context', typeName: 'string' },
  { formulaPath: "globalContext?.['browser']?.['environment']", displayLabel: 'browser.environment', type: 'context', typeName: 'string' },
  { formulaPath: "globalContext?.['browser']?.['theme']", displayLabel: 'browser.theme', type: 'context', typeName: 'string' },
  // Screen context
  { formulaPath: "globalContext?.['screen']?.['width']", displayLabel: 'screen.width', type: 'context', typeName: 'number' },
  { formulaPath: "globalContext?.['screen']?.['height']", displayLabel: 'screen.height', type: 'context', typeName: 'number' },
  { formulaPath: "globalContext?.['screen']?.['scroll']?.['x']", displayLabel: 'screen.scroll.x', type: 'context', typeName: 'number' },
  { formulaPath: "globalContext?.['screen']?.['scroll']?.['y']", displayLabel: 'screen.scroll.y', type: 'context', typeName: 'number' },
  { formulaPath: "globalContext?.['screen']?.['scroll']?.['xPercent']", displayLabel: 'screen.scroll.xPercent', type: 'context', typeName: 'number' },
  { formulaPath: "globalContext?.['screen']?.['scroll']?.['yPercent']", displayLabel: 'screen.scroll.yPercent', type: 'context', typeName: 'number' },
];

/** Repeat-scope context variables (only shown when in a repeated node) */
const ITEM_CONTEXT_VARS: VarRowItem[] = [
  { formulaPath: "context?.['item']", displayLabel: 'item', type: 'context', typeName: 'object' },
  { formulaPath: "context?.['index']", displayLabel: 'index', type: 'context', typeName: 'number' },
  { formulaPath: "context?.['item']?.['parent']", displayLabel: 'item.parent', type: 'context', typeName: 'object' },
];


// ─── Variable Entry (mirrors CollectionEntry exactly, purple instead of blue) ──

const VAR_CHIP = { bg: '#0f766e', bgHover: '#0d9488', border: '#0d9488', text: '#ccfbf1' };

export function VariableEntry({
  variable,
  liveValue,
  onInsert,
  search,
}: {
  variable: CustomVar;
  liveValue: unknown;
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
  search: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [arrayIndices, setArrayIndices] = useState<Map<string, number>>(new Map());

  const rootPath = `variables['${variable.id}']`;
  const label = variable.label ?? variable.name ?? variable.id ?? '';

  // For form variables, build a structured live object; otherwise use the live value
  const treeData: unknown = (() => {
    if (variable.type === 'form' && variable.fields) {
      const live = (liveValue ?? {}) as Record<string, unknown>;
      const value: Record<string, unknown> = {};
      const errors: Record<string, unknown> = {};
      for (const f of variable.fields) {
        value[f.name] = (live.value as Record<string, unknown> | undefined)?.[f.name] ?? f.initialValue ?? '';
        errors[f.name] = (live.errors as Record<string, unknown> | undefined)?.[f.name] ?? null;
      }
      return { value, errors, valid: (live.valid as boolean | undefined) ?? false };
    }
    return liveValue ?? variable.initialValue;
  })();

  // Convert DataTreeNode dot-path → variables['uuid']?.['seg1']?.['seg2'] chip path
  const handleNodeInsert = useCallback((nodePath: string) => {
    const uuid = variable.id ?? '';
    const after = nodePath.replace(new RegExp(`^variables\\['${uuid}'\\]\\.?`), '');
    const chained = after ? after.split('.').filter(Boolean).map(p => `?.['${p}']`).join('') : '';
    const fp = `variables['${uuid}']${chained}`;
    const friendly = after || label;
    onInsert(fp, friendly, 'variable');
  }, [variable.id, label, onInsert]);

  const toggleExpand = (p: string) => setExpanded(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const setArrayIndex = (p: string, idx: number) => setArrayIndices(prev => new Map(prev).set(p, idx));

  // useEffect must be before any conditional return (Rules of Hooks)
  useEffect(() => { if (search) setIsOpen(true); }, [search]);

  const lq = search.toLowerCase();
  if (lq && !label.toLowerCase().includes(lq)) return null;

  const isUndefined = treeData === undefined;

  return (
    <div>
      {/* Header row — matches CollectionEntry exactly */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', cursor: 'default' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Chevron — click to expand/collapse */}
        <span
          style={{ color: '#4b5563', display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', padding: '2px' }}
          onClick={() => setIsOpen(o => !o)}
        >
          <FEChevron open={isOpen} size={8} />
        </span>
        {/* Pill — click inserts root variable */}
        <div
          style={{ display: 'inline-flex', alignItems: 'center', background: VAR_CHIP.bg, border: `1px solid ${VAR_CHIP.border}`, borderRadius: 5, padding: '2px 6px', flexShrink: 0, cursor: 'pointer' }}
          onClick={() => onInsert(rootPath, label, 'variable')}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = VAR_CHIP.bgHover; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = VAR_CHIP.bg; }}
        >
          <span style={{ fontSize: 11, color: VAR_CHIP.text, fontWeight: 600, fontFamily: 'monospace' }}>{label}</span>
        </div>
        {/* Live value preview for primitives; status for undefined */}
        {isUndefined ? (
          <span style={{ fontSize: 9, color: '#374151', fontStyle: 'italic', marginLeft: 'auto' }}>not set</span>
        ) : typeof treeData !== 'object' || treeData === null ? (
          <span style={{ fontSize: 10, color: FE_VALUE_COLOR[feInferType(treeData)] ?? '#9ca3af', fontFamily: 'monospace', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {feValuePreview(treeData)}
          </span>
        ) : null}
      </div>

      {/* Expanded data tree — identical pattern to CollectionEntry */}
      {isOpen && (
        <div>
          {isUndefined ? (
            <div style={{ padding: '3px 10px 5px 34px', fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>
              No value set yet
            </div>
          ) : typeof treeData === 'object' && treeData !== null && !Array.isArray(treeData) ? (
            Object.entries(treeData as Record<string, unknown>).map(([k, v]) => (
              <DataTreeNode
                key={k} fieldName={k} path={`${rootPath}.${k}`} value={v}
                depth={1} onInsert={handleNodeInsert}
                expanded={expanded} toggleExpand={toggleExpand}
                arrayIndices={arrayIndices} setArrayIndex={setArrayIndex}
                chipColor={VAR_CHIP}
              />
            ))
          ) : Array.isArray(treeData) ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 28px' }}>
                <span style={{ fontSize: 9, color: VAR_CHIP.text, fontFamily: 'monospace', fontWeight: 700, minWidth: 14 }}>[]</span>
                <select
                  value={arrayIndices.get(rootPath) ?? 0}
                  onChange={e => { e.stopPropagation(); setArrayIndex(rootPath, Number(e.target.value)); }}
                  onClick={e => e.stopPropagation()}
                  style={{ background: '#1f2937', color: '#d1d5db', border: '1px solid #374151', borderRadius: 4, fontSize: 10, padding: '0 2px', cursor: 'pointer', maxWidth: 52 }}
                >
                  {Array.from({ length: Math.min((treeData as unknown[]).length, 50) }, (_, i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
                <span style={{ fontSize: 9, color: '#4b5563' }}>{(treeData as unknown[]).length} items</span>
              </div>
              {(treeData as unknown[]).length > 0 && (() => {
                const idx = arrayIndices.get(rootPath) ?? 0;
                return (
                  <DataTreeNode
                    fieldName={`${label}[${idx}]`} path={`${rootPath}[${idx}]`} value={(treeData as unknown[])[idx]}
                    depth={1} onInsert={handleNodeInsert}
                    expanded={expanded} toggleExpand={toggleExpand}
                    arrayIndices={arrayIndices} setArrayIndex={setArrayIndex}
                    chipColor={VAR_CHIP}
                  />
                );
              })()}
            </div>
          ) : (
            <div style={{ padding: '3px 10px 5px 34px', fontSize: 10, color: FE_VALUE_COLOR[feInferType(treeData)] ?? '#9ca3af', fontFamily: 'monospace' }}>
              {feValuePreview(treeData)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Variables tab ────────────────────────────────────────────────────────────

const FORM_CC = { bg: '#c2410c', border: '#ea580c', text: '#ffedd5' };

/** Extract field names from a FormContainer's subtree.
 * Sources: initialFormData keys, then props.name on input-type children. */
function extractFormFieldNames(formNode: { props?: { initialFormData?: Record<string, unknown> }; children?: Array<{ type?: string; props?: Record<string, unknown>; children?: unknown[] }> }): string[] {
  const fromInitial = formNode.props?.initialFormData ? Object.keys(formNode.props.initialFormData) : [];
  const INPUT_TYPES = new Set(['InputField', 'TextareaInput', 'Checkbox', 'Select']);
  const fromNames = new Set<string>();
  function walk(nodes: unknown[]) {
    for (const n of nodes || []) {
      const node = n as { type?: string; props?: Record<string, unknown>; children?: unknown[] };
      if (INPUT_TYPES.has(node.type ?? '')) {
        const name = node.props?.name as string | undefined;
        if (name) fromNames.add(name);
      }
      if (node.children?.length) walk(node.children);
    }
  }
  walk(formNode.children ?? []);
  return [...new Set([...fromInitial, ...fromNames])];
}

/** Check if node type is a top-level controlled component (for standalone listing) */
function isStandaloneControlled(type: string): boolean {
  return STANDALONE_VARIABLE_TYPES.has(type);
}

export type StandaloneEntry = { node: SDUINode; insideForm: boolean };
export type FormEntry = { node: SDUINode; fields: string[] };

/** Recursively collect FormContainers and ALL controlled components from page tree.
 * Each standalone entry tracks whether the node is inside a FormContainer so the
 * UI can show "Form - {name}" vs just "{name}" in the Variables tab. */
export function collectPageComponents(
  nodes: SDUINode[],
  parentInsideForm: boolean
): {
  formContainers: FormEntry[];
  standalones: StandaloneEntry[];
  /** All form field names registered across all FormContainers on this page */
  pageFormFields: string[];
} {
  const formContainers: FormEntry[] = [];
  const standalones: StandaloneEntry[] = [];
  const pageFormFields: string[] = [];

  for (const node of nodes) {
    const nodeType = node.type as string;
    const insideForm = parentInsideForm || nodeType === 'FormContainer';
    if (nodeType === 'FormContainer') {
      const fields = extractFormFieldNames(node);
      formContainers.push({ node, fields });
      pageFormFields.push(...fields);
    } else if (isStandaloneControlled(nodeType)) {
      standalones.push({ node, insideForm: parentInsideForm });
    }
    if (node.children?.length) {
      const sub = collectPageComponents(node.children as SDUINode[], insideForm);
      formContainers.push(...sub.formContainers);
      standalones.push(...sub.standalones);
      pageFormFields.push(...sub.pageFormFields);
    }
  }
  return { formContainers, standalones, pageFormFields };
}

// ─── FormContainerEntry ───────────────────────────────────────────────────────
/** Renders one FormContainer as the full tree matching the image:
 *  ▾ { } Form Container - {name}
 *      ▾ { } formData
 *            T fieldName  ""
 *      > { } fields
 *        ⊗ isSubmitting  false
 *        ⊗ isSubmitted   false
 *        ⊗ isValid       true
 *
 * All formulas use variables['{formId}-form']?.['...'] so they live-update
 * whenever FormContainer writes its state to the global variable store.
 */
function FormContainerEntry({
  formId,
  formName,
  onInsert,
  search,
}: {
  formId: string;
  formName: string;
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
  search: string;
}) {
  const [open, setOpen] = useState(true);
  // formData is expanded by default (matching the image); fields collapsed
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['formData']));
  const toggleExpand = useCallback((p: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }, []);

  const vsData = getGlobalVariableStore()(state => state.data);
  const formState = vsData[`${formId}-form`] as {
    formData?: Record<string, unknown>;
    fields?: Record<string, unknown>;
    isSubmitting?: boolean;
    isSubmitted?: boolean;
    isValid?: boolean;
  } | undefined;

  const formDataVal = formState?.formData ?? {};
  const fieldsVal   = formState?.fields   ?? {};

  const CC = { bg: '#0f766e', bgHover: '#115e59', border: '#0d9488', text: '#ccfbf1' };

  // Build formula from a dotPath relative to the root form object
  const formula = (dotPath: string) => {
    const segs = dotPath.split('.').filter(Boolean);
    let f = `variables['${formId}-form']`;
    for (const s of segs) f += `?.['${s}']`;
    return f;
  };

  const lq = search.toLowerCase();
  const matches = (s: string) => !lq || s.toLowerCase().includes(lq);

  const visibleFd = Object.keys(formDataVal).filter(k => matches(k) || matches(formName));
  const visibleFl = Object.keys(fieldsVal).filter(k => matches(k) || matches(formName));
  if (!matches(formName) && visibleFd.length === 0 && visibleFl.length === 0 &&
      !matches('isSubmitting') && !matches('isSubmitted') && !matches('isValid')) return null;

  const pillStyle: React.CSSProperties = {
    background: CC.bg, color: CC.text, border: `1px solid ${CC.border}`,
    borderRadius: 5, padding: '1px 5px', fontSize: 10, fontWeight: 600, fontFamily: 'monospace',
  };
  const rowStyle = (depth: number): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: `3px 12px 3px ${12 + depth * 12}px`, cursor: 'pointer',
  });
  const hover = (e: React.MouseEvent, on: boolean) => {
    (e.currentTarget as HTMLElement).style.background = on ? '#0f1929' : 'transparent';
  };

  return (
    <div data-testid={`form-container-entry-${formId}`}>
      {/* Header: "Form Container - {name}" */}
      <div
        style={rowStyle(0)}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={e => hover(e, true)} onMouseLeave={e => hover(e, false)}
      >
        <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center' }}><FEChevron open={open} size={7} /></span>
        <span
          data-testid={`form-container-chip-${formId}`}
          style={{ ...pillStyle, cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); onInsert(formula(''), `Form Container - ${formName}`, 'variable'); }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        >
          Form Container - {formName}
        </span>
      </div>

      {open && (
        <div>
          {/* formData — DataTreeNode handles expand/collapse, starts expanded */}
          <DataTreeNode
            fieldName="formData" path="formData" value={formDataVal}
            depth={1}
            onInsert={dotPath => onInsert(formula(dotPath), `Form Container - ${formName}.${dotPath}`, 'variable')}
            expanded={expanded} toggleExpand={toggleExpand}
            arrayIndices={new Map()} setArrayIndex={() => {}}
            chipColor={CC}
          />

          {/* fields — starts collapsed */}
          <DataTreeNode
            fieldName="fields" path="fields" value={fieldsVal}
            depth={1}
            onInsert={dotPath => onInsert(formula(dotPath), `Form Container - ${formName}.${dotPath}`, 'variable')}
            expanded={expanded} toggleExpand={toggleExpand}
            arrayIndices={new Map()} setArrayIndex={() => {}}
            chipColor={CC}
          />

          {/* Boolean flags */}
          {(['isSubmitting', 'isSubmitted', 'isValid'] as const).map(key => {
            if (!matches(key) && !matches(formName)) return null;
            const val = formState?.[key];
            return (
              <div
                key={key}
                data-testid={`form-flag-${key}`}
                style={rowStyle(1)}
                onClick={() => onInsert(formula(key), `Form Container - ${formName}.${key}`, 'variable')}
                onMouseEnter={e => hover(e, true)} onMouseLeave={e => hover(e, false)}
              >
                <span style={{ ...pillStyle, opacity: 0.7, fontSize: 9 }}>⊗</span>
                <span style={{ ...pillStyle }}>{key}</span>
                <span style={{ fontSize: 10, color: '#ef4444', fontFamily: 'monospace', marginLeft: 'auto' }}>
                  {String(val ?? false)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PageComponentsSection({
  onInsert,
  search,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
  search: string;
}) {
  const [open, setOpen] = useState(true);
  const pageNodes = useBuilderStore(s => s.pageNodes);
  // Subscribe to variable store so live values update in the list
  const vsData = getGlobalVariableStore()(state => state.data);

  const { standalones, formContainers } = useMemo(
    () => collectPageComponents(pageNodes, false),
    [pageNodes]
  );

  const lq = search.toLowerCase();
  const matchesSearch = (label: string) => !lq || label.toLowerCase().includes(lq);
  const totalCount = standalones.length + formContainers.length;

  if (totalCount === 0) return null;

  const CC = { bg: '#0f766e', border: '#0d9488', text: '#ccfbf1' };

  return (
    <div style={{ borderTop: '1px solid #1f2937' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
      >
        <span style={{ color: '#e2e8f0' }}><FEChevron open={open} size={8} /></span>
        <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600, letterSpacing: '0.05em' }}>From components in current page</span>
        <span style={{ fontSize: 9, color: '#374151', marginLeft: 'auto' }}>{totalCount}</span>
      </button>
      {open && (
        <div style={{ paddingLeft: 8, paddingBottom: 8 }}>

          {/* FormContainers — full tree (formData / fields / booleans) */}
          {formContainers.map(({ node }) => {
            const formId = (node as { id?: string }).id;
            if (!formId) return null;
            const formName = ((node as { name?: string }).name || 'Form').trim();
            return (
              <FormContainerEntry
                key={formId}
                formId={formId}
                formName={formName}
                onInsert={onInsert}
                search={search}
              />
            );
          })}

          {/* Standalone controlled inputs — insert variables['{id}-value'] */}
          {standalones.map(({ node, insideForm }) => {
            const nodeId = (node as { id?: string }).id;
            if (!nodeId) return null;
            const name = ((node as { name?: string }).name || node.type).trim() || 'Input';
            const chipLabel = insideForm ? `Form - ${name}` : name;
            if (!matchesSearch(chipLabel)) return null;
            const val = vsData[`${nodeId}-value`];
            const displayVal = val === undefined ? '""' : JSON.stringify(val);
            return (
              <div
                key={nodeId}
                onClick={() => onInsert(`variables['${nodeId}-value']`, chipLabel, 'variable')}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', cursor: 'pointer' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{ background: CC.bg, color: CC.text, border: `1px solid ${CC.border}`, borderRadius: 5, padding: '1px 5px', fontSize: 10, fontWeight: 600, fontFamily: 'monospace' }}>
                  {chipLabel}
                </span>
                <span style={{ fontSize: 9, color: '#6b7280', marginLeft: 4 }}>- value</span>
                <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace', marginLeft: 'auto' }}>{displayVal}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function VariableTree({
  onSelect,
  search,
  customVars,
  varFolders,
}: {
  onSelect: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
  search: string;
  customVars: CustomVar[];
  varFolders: { id: string; name: string }[];
}) {
  // Subscribe to variable store for live values
  const [vsState, setVsState] = useState<Record<string, unknown>>(() =>
    getGlobalVariableStore().getState().getFullState() as Record<string, unknown>
  );
  useEffect(() => {
    const store = getGlobalVariableStore();
    const unsub = store.subscribe(() => {
      setVsState(store.getState().getFullState() as Record<string, unknown>);
    });
    return unsub;
  }, []);

  // Group variables by folder, preserving order
  const folderMap = useMemo(() => {
    const fm: Map<string, CustomVar[]> = new Map();
    for (const v of customVars) {
      if (!v.id) continue;
      const folderId = v.folderId ?? 'Other';
      if (!fm.has(folderId)) fm.set(folderId, []);
      fm.get(folderId)!.push(v);
    }
    return fm;
  }, [customVars]);

  const orderedFolders = useMemo(() => {
    const configured = varFolders.map(f => f.id);
    const other = [...folderMap.keys()].filter(id => !configured.includes(id));
    return [...configured, ...other].filter(id => folderMap.has(id));
  }, [varFolders, folderMap]);

  const [folderOpen, setFolderOpen] = useState<Record<string, boolean>>({});
  const toggleFolder = (id: string) => setFolderOpen(p => ({ ...p, [id]: !(p[id] ?? true) }));

  const lq = search.toLowerCase();

  if (orderedFolders.length === 0) {
  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
        <div style={{ padding: '16px', fontSize: 11, color: '#4b5563', fontStyle: 'italic', textAlign: 'center' }}>
          {lq ? 'No variables match' : 'No variables configured'}
          </div>
      </div>
    );
  }

            return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {orderedFolders.map(folderId => {
        const folderLabel = varFolders.find(f => f.id === folderId)?.name ?? folderId;
        const vars = folderMap.get(folderId)!;
        const isOpen = folderOpen[folderId] ?? true;
        return (
          <div key={folderId} style={{ borderTop: '1px solid #1f2937' }}>
            {/* Folder header */}
            <button
              onClick={() => toggleFolder(folderId)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
            >
              <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center' }}>
                <FEChevron open={isOpen} size={8} />
              </span>
              <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600, letterSpacing: '0.05em' }}>{folderLabel}</span>
              <span style={{ fontSize: 9, color: '#374151', marginLeft: 'auto' }}>{vars.length}</span>
                  </button>
            {isOpen && vars.map(v => (
              <VariableEntry
                key={v.id}
                variable={v}
                liveValue={vsState[v.id!]}
                onInsert={onSelect}
                search={lq}
              />
                ))}
              </div>
            );
          })}
    </div>
  );
}

// ─── Collections tree helpers ─────────────────────────────────────────────────

function feInferType(v: unknown): 'number' | 'string' | 'boolean' | 'array' | 'object' | 'null' | 'unknown' {
  if (v === null) return 'null';
  if (v === undefined) return 'unknown';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'number') return 'number';
  if (t === 'string') return 'string';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  return 'unknown';
}

const FE_TYPE_ICON: Record<string, string> = {
  number: '#', string: 'T', boolean: '⊘', array: '[]', object: '{}', null: '·', unknown: '?',
};
const FE_TYPE_COLOR: Record<string, string> = {
  number: '#fbbf24', string: '#34d399', boolean: '#a78bfa',
  array: '#60a5fa', object: '#f472b6', null: '#6b7280', unknown: '#6b7280',
};
const FE_VALUE_COLOR: Record<string, string> = {
  number: '#fcd34d', string: '#86efac', boolean: '#c4b5fd',
  null: '#6b7280', unknown: '#9ca3af', array: '#60a5fa', object: '#f9a8d4',
};

function feValuePreview(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (Array.isArray(v)) return `[${(v as unknown[]).length}]`;
  if (typeof v === 'object') return '{…}';
  if (typeof v === 'string') return v.length > 28 ? `"${v.slice(0, 28)}…"` : `"${v}"`;
  return String(v);
}

export function FEChevron({ open, size = 8 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" fill="none" style={{ display: 'block', flexShrink: 0 }}>
      <path
        d={open ? 'M1 2.5 L4 5.5 L7 2.5' : 'M2.5 1 L5.5 4 L2.5 7'}
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Recursive data tree node ─────────────────────────────────────────────────

export function DataTreeNode({
  fieldName, path, value, depth, onInsert, expanded, toggleExpand, arrayIndices, setArrayIndex, chipColor,
}: {
  fieldName: string;
  path: string;
  value: unknown;
  depth: number;
  /** path = the UUID-based DataTreeNode path (storeKey.field[0].name format) */
  onInsert: (path: string) => void;
  expanded: Set<string>;
  toggleExpand: (p: string) => void;
  arrayIndices: Map<string, number>;
  setArrayIndex: (p: string, idx: number) => void;
  /** Optional color scheme for chip — defaults to blue (collections style) */
  chipColor?: { bg: string; bgHover: string; border: string; text: string };
}) {
  const type = feInferType(value);
  const icon = FE_TYPE_ICON[type] ?? '?';
  const iconColor = FE_TYPE_COLOR[type] ?? '#6b7280';
  const isExpandable = type === 'object' || type === 'array';
  const isOpen = expanded.has(path);
  const indent = 10 + depth * 14;

  // Chip colors — fall back to blue (collections default)
  const cc = chipColor ?? { bg: '#1d4ed8', bgHover: '#2563eb', border: '#2563eb', text: '#bfdbfe' };

  return (
    <>
      <div
        data-tree-path={path}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: `3px 8px 3px ${indent}px`, cursor: 'pointer' }}
        onClick={() => { if (isExpandable) toggleExpand(path); else onInsert(path); }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Expand chevron */}
        <span data-tree-chevron style={{ color: '#4b5563', width: 10, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {isExpandable ? <FEChevron open={isOpen} size={8} /> : null}
        </span>

        {/* Type icon */}
        <span style={{ fontSize: 9, color: cc.text, fontFamily: 'monospace', fontWeight: 700, flexShrink: 0, minWidth: 14 }}>{icon}</span>

        {/* Field name chip — clicking inserts path */}
        <button
          onClick={e => { e.stopPropagation(); onInsert(path); }}
          style={{ background: cc.bg, color: cc.text, borderRadius: 5, padding: '2px 4px', fontSize: 11, border: `1px solid ${cc.border}`, cursor: 'pointer', fontFamily: 'monospace', flexShrink: 0, lineHeight: 1.4, fontWeight: 600 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = cc.bgHover; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = cc.bg; }}
        >
          {fieldName}
        </button>


        {/* Array index selector — inline on the array row */}
        {type === 'array' && Array.isArray(value) && (value as unknown[]).length > 0 && (
          <select
            value={arrayIndices.get(path) ?? 0}
            onChange={e => { e.stopPropagation(); setArrayIndex(path, Number(e.target.value)); }}
            onClick={e => e.stopPropagation()}
            style={{ background: '#1f2937', color: '#d1d5db', border: '1px solid #374151', borderRadius: 4, fontSize: 10, padding: '0 2px', cursor: 'pointer', maxWidth: 52 }}
          >
            {Array.from({ length: Math.min((value as unknown[]).length, 50) }, (_, i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        )}

        {/* Value preview for primitives */}
        {!isExpandable && (
          <span style={{ fontSize: 10, color: FE_VALUE_COLOR[type] ?? '#9ca3af', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {feValuePreview(value)}
          </span>
        )}
      </div>

      {/* Object children */}
      {isOpen && type === 'object' && value !== null && (
        Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <DataTreeNode
            key={k} fieldName={k} path={`${path}.${k}`} value={v}
            depth={depth + 1} onInsert={onInsert}
            expanded={expanded} toggleExpand={toggleExpand}
            arrayIndices={arrayIndices} setArrayIndex={setArrayIndex}
            chipColor={chipColor}
          />
        ))
      )}

      {/* Array child — shows selected index */}
      {isOpen && type === 'array' && Array.isArray(value) && (value as unknown[]).length > 0 && (() => {
        const idx = arrayIndices.get(path) ?? 0;
        const item = (value as unknown[])[idx];
        const childPath = `${path}[${idx}]`;
        return (
          <DataTreeNode
            fieldName={`${fieldName}[${idx}]`} path={childPath} value={item}
            depth={depth + 1} onInsert={onInsert}
            expanded={expanded} toggleExpand={toggleExpand}
            arrayIndices={arrayIndices} setArrayIndex={setArrayIndex}
            chipColor={chipColor}
          />
        );
      })()}

      {/* Empty array */}
      {isOpen && type === 'array' && Array.isArray(value) && (value as unknown[]).length === 0 && (
        <div style={{ padding: `2px 8px 2px ${indent + 24}px`, fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>empty array</div>
      )}
    </>
  );
}

// ─── Single collection entry ──────────────────────────────────────────────────

export function CollectionEntry({ src, onInsert, search }: {
  src: DataSourceConfig;
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type'] | 'collection') => void;
  search: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [arrayIndices, setArrayIndices] = useState<Map<string, number>>(new Map());
  const zustandData = useSduiStore(s => s.data);

  // storeKey is the UUID (for config datasources) or unique id (for user-created datasources).
  // Config datasources are stored under collections.UUID; user-created ones under their custom id.
  const storeKey = src.storeIn ?? (src as { id?: string }).id ?? '';
  const data = zustandData[`collections.${storeKey}`] ?? zustandData[storeKey];
  // Re-read label from live store so chip label updates when user edits the datasource label
  const displayName = (src as { _label?: string })._label ?? (src as { name?: string }).name ?? storeKey;

  // Convert DataTreeNode path → formula + display, then bubble up as collection chip
  const handleNodeInsert = useCallback((nodePath: string) => {
    const { formulaPath, displayLabel } = pathToFormulaAndDisplay(nodePath, storeKey, displayName);
    onInsert(formulaPath, displayLabel, 'collection');
  }, [storeKey, displayName, onInsert]);

  useEffect(() => { if (search) setIsOpen(true); }, [search]);

  const toggleExpand = (p: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n;
  });

  // Fix 3: when index changes, migrate expanded state so the child stays open
  const setArrayIndex = (p: string, idx: number) => {
    const oldIdx = arrayIndices.get(p) ?? 0;
    const oldPrefix = `${p}[${oldIdx}]`;
    const newPrefix = `${p}[${idx}]`;
    setArrayIndices(prev => new Map(prev).set(p, idx));
    // Recursively migrate all expanded paths that start with the old index prefix
    // so that deeply-nested open nodes stay open after changing the array index.
    setExpanded(prev => {
      const n = new Set(prev);
      for (const ep of Array.from(prev)) {
        if (ep === oldPrefix || ep.startsWith(oldPrefix + '.') || ep.startsWith(oldPrefix + '[')) {
          n.delete(ep);
          n.add(newPrefix + ep.slice(oldPrefix.length));
        }
      }
      return n;
    });
  };

  return (
    <div>
      {/* Collection header — Fix 2: chevron toggles, pill inserts */}
      <div
        data-testid={`fe-collection-header-${storeKey}`}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', cursor: 'default' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Chevron — click to expand/collapse */}
        <span
          data-testid={`fe-collection-chevron-${storeKey}`}
          style={{ color: '#4b5563', display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', padding: '2px' }}
          onClick={() => setIsOpen(o => !o)}
        >
          <FEChevron open={isOpen} size={8} />
        </span>
        {/* Blue pill — click to insert collection chip for root path */}
        <div
          data-testid={`fe-collection-pill-${storeKey}`}
          style={{ display: 'inline-flex', alignItems: 'center', background: '#1d4ed8', border: '1px solid #2563eb', borderRadius: 5, padding: '2px 6px', flexShrink: 0, cursor: 'pointer' }}
          onClick={() => onInsert(buildFormulaPath(storeKey, []), displayName, 'collection')}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2563eb'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#1d4ed8'; }}
        >
          <span style={{ fontSize: 11, color: '#bfdbfe', fontWeight: 600, fontFamily: 'monospace' }}>{displayName}</span>
        </div>
        {data === undefined && (
          <span style={{ fontSize: 9, color: '#374151', fontStyle: 'italic', marginLeft: 'auto' }}>not fetched</span>
        )}
      </div>

      {/* Expanded data tree */}
      {isOpen && (
        <div>
          {data === undefined ? (
            <div style={{ padding: '3px 10px 5px 34px', fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>
              Run fetch in Data tab to see structure
            </div>
          ) : typeof data === 'object' && data !== null && !Array.isArray(data) ? (
            // Object: render each key directly
            Object.entries(data as Record<string, unknown>).map(([k, v]) => (
              <DataTreeNode
                key={k} fieldName={k} path={`${storeKey}.${k}`} value={v}
                depth={1} onInsert={handleNodeInsert}
                expanded={expanded} toggleExpand={toggleExpand}
                arrayIndices={arrayIndices} setArrayIndex={setArrayIndex}
              />
            ))
          ) : Array.isArray(data) ? (
            // Fix 1: Array — render array root inline WITHOUT repeating the collection name
            <div>
              {/* Array index selector row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 28px' }}>
                <span style={{ fontSize: 9, color: '#60a5fa', fontFamily: 'monospace', fontWeight: 700, minWidth: 14 }}>[]</span>
                <select
                  value={arrayIndices.get(storeKey) ?? 0}
                  onChange={e => { e.stopPropagation(); setArrayIndex(storeKey, Number(e.target.value)); }}
                  onClick={e => e.stopPropagation()}
                  style={{ background: '#1f2937', color: '#d1d5db', border: '1px solid #374151', borderRadius: 4, fontSize: 10, padding: '0 2px', cursor: 'pointer', maxWidth: 52 }}
                >
                  {Array.from({ length: Math.min((data as unknown[]).length, 50) }, (_, i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
                <span style={{ fontSize: 9, color: '#4b5563' }}>{(data as unknown[]).length} items</span>
              </div>
              {/* Selected item subtree */}
              {(data as unknown[]).length > 0 && (() => {
                const idx = arrayIndices.get(storeKey) ?? 0;
                const item = (data as unknown[])[idx];
                const childPath = `${storeKey}[${idx}]`;
                return (
                  <DataTreeNode
                    fieldName={`[${idx}]`} path={childPath} value={item}
                    depth={1} onInsert={handleNodeInsert}
                    expanded={expanded} toggleExpand={toggleExpand}
                    arrayIndices={arrayIndices} setArrayIndex={setArrayIndex}
                  />
                );
              })()}
            </div>
          ) : (
            // Primitive / other
            <DataTreeNode
              fieldName={displayName} path={storeKey} value={data}
              depth={1} onInsert={handleNodeInsert}
              expanded={expanded} toggleExpand={toggleExpand}
              arrayIndices={arrayIndices} setArrayIndex={setArrayIndex}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Data-tab Context / Pages / Theme sections ────────────────────────────────

/** Pill chip for context group headers (like weWeb's colored chips) */
function ContextGroupPill({
  icon, label, bg, border, textColor,
}: { icon: string; label: string; bg: string; border: string; textColor: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: bg, border: `1px solid ${border}`, borderRadius: 5, padding: '2px 6px', cursor: 'pointer' }}>
      <span style={{ fontSize: 10, color: textColor, fontFamily: 'monospace', fontWeight: 700 }}>{icon}</span>
      <span style={{ fontSize: 11, color: textColor, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

/** Predefined chip color schemes */
const CHIP_COLORS = {
  purple:  { bg: '#4c1d95', bgHover: '#6d28d9', border: '#7c3aed', text: '#ddd6fe' },
  green:   { bg: '#064e3b', bgHover: '#065f46', border: '#047857', text: '#6ee7b7' },
  blue:    { bg: '#1e3a5f', bgHover: '#1d4ed8', border: '#2563eb', text: '#93c5fd' },
  teal:    { bg: '#134e4a', bgHover: '#0f766e', border: '#0d9488', text: '#5eead4' },
  pink:    { bg: '#831843', bgHover: '#9d174d', border: '#be185d', text: '#fbcfe8' },
} as const;

/** A group row inside CONTEXT/PAGES — weWeb-style: chevron + colored pill + expandable data tree */
function ContextGroupRow({
  icon, label, bg, border, textColor, chipColor, formulaBase, data, depth = 1, onInsert,
}: {
  icon: string; label: string; bg: string; border: string; textColor: string;
  /** Color scheme propagated to all child DataTreeNode chips */
  chipColor: typeof CHIP_COLORS[keyof typeof CHIP_COLORS];
  formulaBase: string;
  data: Record<string, unknown> | null | undefined;
  depth?: number;
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [arrayIndices, setArrayIndices] = useState<Map<string, number>>(new Map());
  const indent = 10 + depth * 14;

  const toggleExpand = (p: string) => setExpanded(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const setArrayIndex = (p: string, idx: number) => setArrayIndices(prev => new Map(prev).set(p, idx));

  const handleNodeInsert = (path: string) => {
    const segs = path.split('.').filter(Boolean);
    let formula = formulaBase;
    for (const seg of segs) formula += `?.['${seg}']`;
    onInsert(formula, path, 'context');
  };

  return (
    <div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: `5px 10px 5px ${indent}px`, cursor: 'default' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span
          style={{ color: '#4b5563', display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', padding: '2px' }}
          onClick={() => setOpen(o => !o)}
        >
          <FEChevron open={open} size={8} />
        </span>
        <div
          onClick={() => { onInsert(formulaBase, label, 'context'); }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        >
          <ContextGroupPill icon={icon} label={label} bg={bg} border={border} textColor={textColor} />
        </div>
        {data === undefined && (
          <span style={{ fontSize: 9, color: '#374151', fontStyle: 'italic', marginLeft: 'auto' }}>live</span>
        )}
        {data === null && (
          <span style={{ fontSize: 9, color: '#fca5a5', fontStyle: 'italic', marginLeft: 'auto' }}>empty</span>
        )}
      </div>
      {open && (
        <div>
          {!data ? (
            <div style={{ padding: `3px 10px 5px ${indent + 24}px`, fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>
              {data === null ? '{empty}' : 'Available at runtime'}
            </div>
          ) : (
            Object.entries(data).map(([k, v]) => (
              <DataTreeNode
                key={k} fieldName={k} path={k} value={v}
                depth={depth + 1} onInsert={handleNodeInsert}
                expanded={expanded} toggleExpand={toggleExpand}
                arrayIndices={arrayIndices} setArrayIndex={setArrayIndex}
                chipColor={chipColor}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Dynamic context.item group — shows full weWeb-style structure with data/parent/index/etc. */
export function ItemContextGroup({
  onInsert,
  initialOpen = false,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [expanded, setExpanded] = useState<Set<string>>(() => initialOpen ? new Set(['data']) : new Set());
  const [arrayIndices, setArrayIndices] = useState<Map<string, number>>(new Map());
  const selectedIds = useBuilderStore(s => s.selectedIds);
  const pageNodes = useBuilderStore(s => s.pageNodes);
  const zustandData = useSduiStore(s => s.data);

  // Find the nearest map ancestor (for inner repeat) and outer map ancestor (for nested repeat)
  const { innerMap, outerMap } = useMemo(() => {
    const id = selectedIds[0];
    if (!id) return { innerMap: null, outerMap: null };
    let node = findNode(pageNodes, id);
    let inner: string | null = null;
    let outer: string | null = null;
    while (node) {
      if (node.map) {
        if (!inner) { inner = node.map as string; }
        else if (!outer) { outer = node.map as string; break; }
      }
      const parent = findParentNode(pageNodes, node.id ?? '');
      node = parent ?? null;
    }
    return { innerMap: inner, outerMap: outer };
  }, [selectedIds, pageNodes]);

  // Extract first item from a map binding path (e.g. "collections.UUID.data.search.items")
  const resolveFirstItem = useCallback((mapBinding: string | null): Record<string, unknown> | null => {
    if (!mapBinding) return null;
    const parts = mapBinding.split('.');
    for (let i = 2; i <= parts.length; i++) {
      const key = parts.slice(0, i).join('.');
      if (zustandData[key] !== undefined) {
        let val: unknown = zustandData[key];
        for (let j = i; j < parts.length; j++) {
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            val = (val as Record<string, unknown>)[parts[j]];
          } else { break; }
        }
        if (Array.isArray(val) && val.length > 0) return val[0] as Record<string, unknown>;
        if (val && typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
      }
    }
    return null;
  }, [zustandData]);

  const itemData = useMemo(() => resolveFirstItem(innerMap), [resolveFirstItem, innerMap]);
  const parentData = useMemo(() => resolveFirstItem(outerMap), [resolveFirstItem, outerMap]);

  const toggleExpand = (p: string) => setExpanded(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const setArrayIndex = (p: string, idx: number) => setArrayIndices(prev => new Map(prev).set(p, idx));

  // Convert a dot-path relative to context.item into a formula chip.
  // Must use "context.item" (dot notation at root) so CHIP_RE can match it.
  const handleItemInsert = useCallback((dotPath: string) => {
    const segs = dotPath.split('.').filter(Boolean);
    // "context.item" prefix so CHIP_RE matches; then optional-chaining brackets for sub-keys
    let formula = 'context.item';
    for (const seg of segs) formula += `?.['${seg}']`;
    // Friendly label: "item.data.productName" (always prefixed with "item.")
    const friendly = segs.length > 0 ? `item.${segs.join('.')}` : 'item';
    onInsert(formula, friendly, 'context');
  }, [onInsert]);

  const cc = CHIP_COLORS.purple;

  // Build the full weWeb-style item context object for display.
  // All fields — actual data AND repeat metadata — live under `data` so every
  // path is item.data.xxx (consistent with the runtime structure).
  const parentCtxValue = parentData
    ? { data: { ...parentData, index: 0, repeatIndex: 0, isACopy: false, parent: null, repeatedItems: [parentData] } }
    : null;
  const fullItemCtx = innerMap ? {
    data: {
      ...(itemData ?? {}),
      index: 0,
      repeatIndex: 0,
      isACopy: false,
      parent: parentCtxValue,
      repeatedItems: itemData ? [itemData] : [],
    },
  } : null;

  const statusLabel = !innerMap ? 'no repeat context'
    : !itemData ? 'fetch to inspect'
    : null;

  return (
    <div>
      {/* item row header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 24px', cursor: 'default' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span
          style={{ color: '#4b5563', display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer', padding: '2px' }}
          onClick={() => setOpen(o => !o)}
        >
          <FEChevron open={open} size={8} />
        </span>
        <div
          onClick={() => { onInsert('context.item', 'item', 'context'); }}
          style={{ cursor: 'pointer' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        >
          <ContextGroupPill icon="{}" label="item" bg={cc.bg} border={cc.border} textColor={cc.text} />
        </div>
        {statusLabel && (
          <span style={{ fontSize: 9, color: '#4b5563', fontStyle: 'italic', marginLeft: 4 }}>{statusLabel}</span>
        )}
      </div>

      {/* Expanded: full weWeb-style tree */}
      {open && fullItemCtx && (
        <div>
          {Object.entries(fullItemCtx).map(([k, v]) => (
            <DataTreeNode
              key={k} fieldName={k} path={k} value={v}
              depth={3} onInsert={handleItemInsert}
              expanded={expanded} toggleExpand={toggleExpand}
              arrayIndices={arrayIndices} setArrayIndex={setArrayIndex}
              chipColor={cc}
            />
          ))}
        </div>
      )}
      {open && !fullItemCtx && (
        <div style={{ padding: '3px 10px 5px 44px', fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>
          Select a node inside a repeated list
        </div>
      )}
    </div>
  );
}

/** CONTEXT section — weWeb-style: item, Current page, Browser, Screen */
/** LOCAL section — shows FormContainer's local.data.form.* when inside a FormContainer.
 * `pageFormFields` filters displayed fields to those registered on the current page.
 * `variant="variables"` shows a green "Form container - form" tree (for the Variables tab).
 * Default variant shows the orange "Local > local.data > form" tree (for the Quick tab). */
export function FormLocalSection({
  onInsert,
  pageFormFields,
  nearestFormContainerId,
  variant = 'quick',
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
  pageFormFields?: string[];
  /** ID of the nearest ancestor FormContainer of the selected node.
   * When set, reads from the isolated variables['{id}-form'] store key instead
   * of the shared local.data.form — ensures nested FormContainers show their own scope. */
  nearestFormContainerId?: string | null;
  variant?: 'quick' | 'variables';
}) {
  const [open, setOpen] = useState(true);
  // Collapsible expanded state for the DataTreeNode sections
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    new Set(['form.formData', 'form.fields'])
  );
  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  // Use Zustand selector directly — avoids useSyncExternalStore getSnapshot
  // instability (getFullState creates a new object every call → infinite loop).
  const vsData = getGlobalVariableStore()(state => state.data);

  const formState = useMemo(() => {
    // Prefer the per-container isolated store (variables['{id}-form']) when a nearest
    // FormContainer is known. This ensures nested containers show their own scope, not
    // the shared local.data.form which is overwritten by the last-mounted container.
    const isolated = nearestFormContainerId
      ? (vsData[`${nearestFormContainerId}-form`] ?? null) as Record<string, unknown> | null
      : null;

    const raw = (isolated ?? (() => {
      const local = (vsData['local'] ?? {}) as Record<string, unknown>;
      const data = (local['data'] ?? {}) as Record<string, unknown>;
      return data['form'] ?? {};
    })()) as {
      formData?: Record<string, unknown>;
      fields?: Record<string, { value: unknown; isValid: boolean }>;
      isSubmitting?: boolean;
      isSubmitted?: boolean;
      isValid?: boolean;
    };

    const base = {
      formData: raw.formData ?? {},
      fields: raw.fields ?? {},
      isSubmitting: raw.isSubmitting ?? false,
      isSubmitted: raw.isSubmitted ?? false,
      isValid: raw.isValid ?? false,
    };

    // Filter formData and fields to only keys present on the current page/form.
    // This prevents field names from other pages from leaking into the Quick tab.
    if (pageFormFields && pageFormFields.length > 0) {
      const allowed = new Set(pageFormFields);
      return {
        ...base,
        formData: Object.fromEntries(Object.entries(base.formData).filter(([k]) => allowed.has(k))),
        fields: Object.fromEntries(Object.entries(base.fields).filter(([k]) => allowed.has(k))),
      };
    }
    return base;
  }, [vsData, pageFormFields, nearestFormContainerId]);

  const FORM_CC   = { bg: '#c2410c', bgHover: '#b91c0c', border: '#ea580c', text: '#ffedd5' };
  // Green chips for the Variables tab variant
  const VAR_GREEN = { bg: '#0f766e', bgHover: '#0d9488', border: '#0d9488', text: '#ccfbf1' };

  const handleInsert = (subPath: string, label: string) => {
    // Build optional-chaining formula: local.data?.['form']?.['subPath']
    const segs = subPath.split('.').filter(Boolean);
    let formula = 'local.data';
    for (const seg of segs) formula += `?.['${seg}']`;
    onInsert(formula, `local.data.${subPath}`, 'form');
  };

  const [localDataOpen, setLocalDataOpen] = useState(true);
  const [formOpen, setFormOpen] = useState(true);

  // ── Variables-tab variant: green "Form container - form" tree ────────────────
  if (variant === 'variables') {
    const cc = VAR_GREEN;
    return (
      <div style={{ borderTop: '1px solid #1f2937' }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        >
          <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center' }}><FEChevron open={open} size={8} /></span>
          <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600, letterSpacing: '0.05em' }}>Form container</span>
        </button>
        {open && (
          <div style={{ paddingLeft: 8 }}>
            {/* "form" pill — collapsible, mirrors Quick tab structure */}
            <div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 12px', cursor: 'pointer' }}
                onClick={() => setFormOpen(o => !o)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', marginRight: 2 }}><FEChevron open={formOpen} size={7} /></span>
                <div
                  onClick={e => { e.stopPropagation(); handleInsert('form', 'local.data.form'); }}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                >
                  <ContextGroupPill icon="{}" label="form" bg={cc.bg} border={cc.border} textColor={cc.text} />
                </div>
              </div>
              {formOpen && (
                <div style={{ paddingLeft: 16 }}>
                  <DataTreeNode
                    fieldName="formData" path="form.formData" value={formState.formData}
                    depth={2} onInsert={(dotPath) => handleInsert(dotPath, `local.data.${dotPath}`)}
                    expanded={expanded} toggleExpand={toggleExpand}
                    arrayIndices={new Map()} setArrayIndex={() => {}}
                    chipColor={cc}
                  />
                  <DataTreeNode
                    fieldName="fields" path="form.fields" value={formState.fields}
                    depth={2} onInsert={(dotPath) => handleInsert(dotPath, `local.data.${dotPath}`)}
                    expanded={expanded} toggleExpand={toggleExpand}
                    arrayIndices={new Map()} setArrayIndex={() => {}}
                    chipColor={cc}
                  />
                  {/* Boolean flags */}
                  {(['isSubmitting', 'isSubmitted', 'isValid'] as const).map(key => (
                    <div
                      key={key}
                      onClick={() => handleInsert(`form.${key}`, `local.data.form.${key}`)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 12px', cursor: 'pointer' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span style={{ background: cc.bg, color: cc.text, border: `1px solid ${cc.border}`, borderRadius: 5, padding: '1px 5px', fontSize: 10, fontWeight: 600, fontFamily: 'monospace', opacity: 0.8 }}>⊗</span>
                      <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>{key}</span>
                      <span style={{ fontSize: 10, color: '#ef4444', fontFamily: 'monospace', marginLeft: 'auto' }}>
                        {String(formState[key])}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* LOCAL header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
      >
        <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center' }}><FEChevron open={open} size={8} /></span>
        <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600, letterSpacing: '0.05em' }}>Local</span>
      </button>

      {open && (
        <div style={{ paddingLeft: 8 }}>
          {/* local.data root pill — collapsible */}
          <div>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 12px', cursor: 'pointer' }}
              onClick={() => setLocalDataOpen(o => !o)}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', marginRight: 2 }}><FEChevron open={localDataOpen} size={7} /></span>
              <div
                onClick={e => { e.stopPropagation(); handleInsert('', 'local.data'); }}
                style={{ cursor: 'pointer' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              >
                <ContextGroupPill icon="{}" label="local.data" bg={FORM_CC.bg} border={FORM_CC.border} textColor={FORM_CC.text} />
              </div>
            </div>

            {localDataOpen && (
              <div style={{ paddingLeft: 16 }}>
                {/* form pill — collapsible */}
                <div>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 12px', cursor: 'pointer' }}
                    onClick={() => setFormOpen(o => !o)}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', marginRight: 2 }}><FEChevron open={formOpen} size={7} /></span>
                    <div
                      data-testid="formula-local-form-pill"
                      onClick={e => { e.stopPropagation(); handleInsert('form', 'local.data.form'); }}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                    >
                      <ContextGroupPill icon="{}" label="form" bg={FORM_CC.bg} border={FORM_CC.border} textColor={FORM_CC.text} />
                    </div>
                  </div>

                  {formOpen && (
                    <div style={{ paddingLeft: 16 }}>
                      {/* formData */}
                      <DataTreeNode
                        fieldName="formData" path="form.formData" value={formState.formData}
                        depth={2} onInsert={(dotPath) => handleInsert(dotPath, `local.data.${dotPath}`)}
                        expanded={expanded} toggleExpand={toggleExpand}
                        arrayIndices={new Map()} setArrayIndex={() => {}}
                        chipColor={FORM_CC}
                      />

                      {/* fields */}
                      <DataTreeNode
                        fieldName="fields" path="form.fields" value={formState.fields}
                        depth={2} onInsert={(dotPath) => handleInsert(dotPath, `local.data.${dotPath}`)}
                        expanded={expanded} toggleExpand={toggleExpand}
                        arrayIndices={new Map()} setArrayIndex={() => {}}
                        chipColor={FORM_CC}
                      />

                      {/* scalar flags */}
                      {(['isSubmitting', 'isSubmitted', 'isValid'] as const).map(key => (
                        <div
                          key={key}
                          data-testid={`formula-local-${key}`}
                          onClick={() => handleInsert(`form.${key}`, `local.data.form.${key}`)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 12px', cursor: 'pointer' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                          <span
                            style={{
                              background: FORM_CC.bg, color: FORM_CC.text, border: `1px solid ${FORM_CC.border}`,
                              borderRadius: 5, padding: '1px 5px', fontSize: 10, fontWeight: 600, fontFamily: 'monospace', cursor: 'pointer',
                            }}
                          >
                            {key}
                          </span>
                          <span style={{ fontSize: 10, color: String(formState[key]) === 'true' ? '#4ade80' : '#9ca3af', fontFamily: 'monospace', marginLeft: 'auto' }}>
                            {String(formState[key])}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ContextDataSection({
  onInsert,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
}) {
  const [open, setOpen] = useState(false);

  // Build Browser data object for display
  const browserData = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return {
      url: window.location.href,
      path: window.location.pathname,
      domain: window.location.hostname,
      baseUrl: window.location.origin,
      query: Object.fromEntries(new URLSearchParams(window.location.search)),
      breakpoint: window.innerWidth < 640 ? 'xs' : window.innerWidth < 768 ? 'sm' : window.innerWidth < 1024 ? 'md' : window.innerWidth < 1280 ? 'lg' : 'xl',
      environment: process.env.NODE_ENV ?? 'development',
      theme: 'system',
    };
  }, []);

  const screenData = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scroll: { x: window.scrollX, y: window.scrollY, xPercent: 0, yPercent: 0 },
    };
  }, []);

  return (
    <div style={{ borderTop: '1px solid #1f2937' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
      >
        <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center' }}><FEChevron open={open} size={8} /></span>
        <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600, letterSpacing: '0.05em' }}>Context</span>
      </button>
      {open && (
        <div>
          {/* item — dynamic from repeat context */}
          <ItemContextGroup onInsert={onInsert} />
          {/* Current page */}
          <ContextGroupRow
            icon="⌂" label="Current page" bg={CHIP_COLORS.green.bg} border={CHIP_COLORS.green.border} textColor={CHIP_COLORS.green.text}
            chipColor={CHIP_COLORS.green}
            formulaBase="globalContext?.['browser']"
            data={browserData ? { path: browserData.path, query: browserData.query } : null}
            depth={1}
            onInsert={onInsert}
          />
          {/* Browser */}
          <ContextGroupRow
            icon="{}" label="Browser" bg={CHIP_COLORS.green.bg} border={CHIP_COLORS.green.border} textColor={CHIP_COLORS.green.text}
            chipColor={CHIP_COLORS.green}
            formulaBase="globalContext?.['browser']"
            data={browserData}
            depth={1}
            onInsert={onInsert}
          />
          {/* Screen */}
          <ContextGroupRow
            icon="⬛" label="Screen" bg={CHIP_COLORS.green.bg} border={CHIP_COLORS.green.border} textColor={CHIP_COLORS.green.text}
            chipColor={CHIP_COLORS.green}
            formulaBase="globalContext?.['screen']"
            data={screenData}
            depth={1}
            onInsert={onInsert}
          />
        </div>
      )}
    </div>
  );
}

/** PAGES section — all app routes, weWeb-style */
export function PagesDataSection({
  onInsert,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
}) {
  const [open, setOpen] = useState(false);

  type RouteEntry = { path: string; config: string; id?: string; auth?: boolean; dynamic?: boolean };
  const routes = (routesConfig as { routes?: RouteEntry[] }).routes ?? [];

  return (
    <div style={{ borderTop: '1px solid #1f2937' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
      >
        <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center' }}><FEChevron open={open} size={8} /></span>
        <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600, letterSpacing: '0.05em' }}>Pages</span>
        <span style={{ fontSize: 9, color: '#374151', marginLeft: 'auto' }}>{routes.length}</span>
      </button>
      {open && (
        <div>
          {routes.map(r => {
            const key = r.id ?? r.config;
            const pageData: Record<string, unknown> = { id: key, path: r.path, name: r.config, dynamic: r.dynamic ?? false, auth: r.auth ?? false };
            return (
              <ContextGroupRow
                key={key}
                icon="⌂" label={r.config}
                bg={CHIP_COLORS.blue.bg} border={CHIP_COLORS.blue.border} textColor={CHIP_COLORS.blue.text}
                chipColor={CHIP_COLORS.blue}
                formulaBase={`pages?.['${key}']`}
                data={pageData}
                depth={1}
                onInsert={(fp, dl) => onInsert(fp, dl, 'pages')}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** COLORS section — theme colors with swatches */
// ── Shared theme chip styles ──────────────────────────────────────────────────
const THEME_CHIP    = { bg: '#92400e', bgHover: '#b45309', border: '#d97706', text: '#fef3c7' } as const;
const THEME_ACCENT  = '#fdba74'; // unified accent for all theme section headers (COLORS, TYPOGRAPHY, BORDER RADIUS)

/** A single theme row: swatch (optional) + colored chip + value preview */
function ThemeRow({
  icon, label, value, formulaPath, displayLabel, onInsert,
  swatch,
}: {
  icon?: string;
  label: string;
  value: string;
  formulaPath: string;
  displayLabel: string;
  onInsert: (fp: string, dl: string, t: VarRowItem['type']) => void;
  swatch?: boolean;
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 24px', cursor: 'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      onClick={() => onInsert(formulaPath, displayLabel, 'theme')}
    >
      {/* Color swatch OR text icon */}
      {swatch
        ? <span style={{ width: 14, height: 14, borderRadius: 3, background: value, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />
        : <span style={{ fontSize: 10, color: THEME_CHIP.text, fontFamily: 'monospace', fontWeight: 700, flexShrink: 0, minWidth: 16 }}>{icon ?? 'Aa'}</span>
      }
      {/* Name chip */}
      <button
        style={{ background: THEME_CHIP.bg, color: THEME_CHIP.text, borderRadius: 5, padding: '2px 5px', fontSize: 11, border: `1px solid ${THEME_CHIP.border}`, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 600, flexShrink: 0 }}
        onClick={e => { e.stopPropagation(); onInsert(formulaPath, displayLabel, 'theme'); }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = THEME_CHIP.bgHover; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = THEME_CHIP.bg; }}
      >
        {label}
      </button>
      {/* Value preview */}
      <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{value}</span>
    </div>
  );
}

/** Reusable collapsible theme section header */
function ThemeSectionHeader({ open, onToggle, accent, label, count }: { open: boolean; onToggle: () => void; accent: string; label: string; count: number }) {
  return (
    <button
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
    >
      <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center' }}><FEChevron open={open} size={8} /></span>
      <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600, letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 9, color: '#374151', marginLeft: 'auto' }}>{count}</span>
    </button>
  );
}

/** COLORS section — all theme colors with swatches, consistent pink chips */
export function ColorsDataSection({
  onInsert,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
}) {
  const [open, setOpen] = useState(false);
  const tc = themeConfig as Record<string, unknown>;
  const colors = (tc.colors ?? {}) as Record<string, string>;

  return (
    <div style={{ borderTop: '1px solid #1f2937' }}>
      <ThemeSectionHeader open={open} onToggle={() => setOpen(o => !o)} accent={THEME_ACCENT} label="Colors" count={Object.keys(colors).length} />
      {open && (
        <div>
          {Object.entries(colors).map(([k, v]) => (
            <ThemeRow
              key={k} swatch label={k} value={v}
              formulaPath={`theme?.['colors']?.['${k}']`}
              displayLabel={`Color - ${k}`}
              onInsert={onInsert}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** TYPOGRAPHY section — fonts (heading, body) with live font preview */
export function TypographyDataSection({
  onInsert,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
}) {
  const [open, setOpen] = useState(false);
  const tc = themeConfig as Record<string, unknown>;
  const fonts = (tc.fonts ?? {}) as Record<string, string>;

  if (Object.keys(fonts).length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid #1f2937' }}>
      <ThemeSectionHeader open={open} onToggle={() => setOpen(o => !o)} accent={THEME_ACCENT} label="Typography" count={Object.keys(fonts).length} />
      {open && (
        <div>
          {Object.entries(fonts).map(([k, v]) => (
            <div
              key={k}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 24px', cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onClick={() => onInsert(`theme?.['fonts']?.['${k}']`, `Typography - ${k}`, 'theme')}
            >
              {/* Live font preview */}
              <span style={{ fontSize: 13, color: THEME_ACCENT, fontWeight: 700, flexShrink: 0, minWidth: 20, letterSpacing: '-0.03em' }}>Aa</span>
              <button
                style={{ background: THEME_CHIP.bg, color: THEME_CHIP.text, borderRadius: 5, padding: '2px 5px', fontSize: 11, border: `1px solid ${THEME_CHIP.border}`, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 600, flexShrink: 0 }}
                onClick={e => { e.stopPropagation(); onInsert(`theme?.['fonts']?.['${k}']`, `Typography - ${k}`, 'theme'); }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = THEME_CHIP.bgHover; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = THEME_CHIP.bg; }}
              >
                {k}
              </button>
              <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** BORDER RADIUS section — reads --radius from cssVariables.root + common Tailwind tokens */
export function BorderRadiusDataSection({
  onInsert,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
}) {
  const [open, setOpen] = useState(false);
  const tc = themeConfig as Record<string, unknown>;
  const cssRoot = ((tc.cssVariables as Record<string, unknown> | undefined)?.root ?? {}) as Record<string, string>;
  const radiusValue = cssRoot['--radius'] ?? '0.5rem';

  // Standard Tailwind border-radius tokens
  const tokens: Array<{ label: string; value: string; cls: string }> = [
    { label: 'none',   value: '0px',         cls: 'rounded-none'  },
    { label: 'sm',     value: '0.125rem',     cls: 'rounded-sm'    },
    { label: 'base',   value: radiusValue,    cls: 'rounded'       },
    { label: 'md',     value: '0.375rem',     cls: 'rounded-md'    },
    { label: 'lg',     value: '0.5rem',       cls: 'rounded-lg'    },
    { label: 'xl',     value: '0.75rem',      cls: 'rounded-xl'    },
    { label: '2xl',    value: '1rem',         cls: 'rounded-2xl'   },
    { label: '3xl',    value: '1.5rem',       cls: 'rounded-3xl'   },
    { label: 'full',   value: '9999px',       cls: 'rounded-full'  },
  ];

  return (
    <div style={{ borderTop: '1px solid #1f2937' }}>
      <ThemeSectionHeader open={open} onToggle={() => setOpen(o => !o)} accent={THEME_ACCENT} label="Border Radius" count={tokens.length} />
      {open && (
        <div>
          {tokens.map(t => (
            <div
              key={t.label}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 24px', cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              onClick={() => onInsert(`theme?.['radius']?.['${t.label}']`, `Radius - ${t.label}`, 'theme')}
            >
              {/* Visual radius preview */}
              <span style={{ width: 14, height: 14, borderRadius: t.label === 'full' ? '50%' : t.label === 'none' ? 0 : t.value, border: `1.5px solid ${THEME_ACCENT}`, flexShrink: 0, display: 'inline-block' }} />
              <button
                style={{ background: THEME_CHIP.bg, color: THEME_CHIP.text, borderRadius: 5, padding: '2px 5px', fontSize: 11, border: `1px solid ${THEME_CHIP.border}`, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 600, flexShrink: 0 }}
                onClick={e => { e.stopPropagation(); onInsert(`theme?.['radius']?.['${t.label}']`, `Radius - ${t.label}`, 'theme'); }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = THEME_CHIP.bgHover; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = THEME_CHIP.bg; }}
              >
                {t.label}
              </button>
              <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>{t.cls === 'rounded' ? `${t.cls} (${radiusValue})` : t.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Collections data tab (replaces DataSourceList) ──────────────────────────

export function CollectionsDataTab({ onInsert, search }: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type'] | 'collection') => void;
  search: string;
}) {
  const pageDataSources = useBuilderStore(s => s.pageDataSources);
  const [collectionsOpen, setCollectionsOpen] = useState(true);

  const filtered = search
    ? pageDataSources.filter(s => {
        const label = (s as { _label?: string })._label ?? (s as { name?: string }).name ?? '';
        return label.toLowerCase().includes(search.toLowerCase());
      })
    : pageDataSources;

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {/* COLLECTIONS section */}
      <button
        onClick={() => setCollectionsOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', background: 'none', border: 'none', borderBottom: '1px solid #1f2937', cursor: 'pointer', textAlign: 'left' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f172a'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
      >
        <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center' }}><FEChevron open={collectionsOpen} size={8} /></span>
        <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600, letterSpacing: '0.05em' }}>Collections</span>
        <span style={{ fontSize: 9, color: '#374151', marginLeft: 'auto' }}>{filtered.length}</span>
      </button>

      {collectionsOpen && (
        <>
          {filtered.length === 0 ? (
            <div style={{ padding: '12px', fontSize: 10, color: '#4b5563', fontStyle: 'italic', textAlign: 'center' }}>
              {pageDataSources.length === 0
                ? 'Add a data source in the Data tab'
                : 'No sources match your search'}
            </div>
          ) : (
            filtered.map(src => (
              <CollectionEntry key={src.id} src={src} onInsert={onInsert} search={search} />
            ))
          )}
        </>
      )}

      {/* Context — item / current page / browser / screen */}
      <ContextDataSection onInsert={onInsert} />
      {/* Pages — all app routes */}
      <PagesDataSection onInsert={onInsert} />
      {/* Theme — colors with swatches */}
      <ColorsDataSection onInsert={onInsert} />
      {/* Typography */}
      <TypographyDataSection onInsert={onInsert} />
      {/* Border Radius */}
      <BorderRadiusDataSection onInsert={onInsert} />
    </div>
  );
}

// ─── Function Library ─────────────────────────────────────────────────────────

export function FunctionLibrary({ onInsert, onInsertFn, search, globalFormulas }: {
  onInsert: (text: string) => void;
  onInsertFn: (fnInsert: string, signature: string) => void;
  search: string;
  globalFormulas: Record<string, unknown>;
}) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    () => new Set(Object.keys(FUNCTION_LIBRARY))
  );
  const toggleCat = (cat: string) =>
    setExpandedCats(p => { const n = new Set(p); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const q = search.toLowerCase();

  const fromProject = Object.keys(globalFormulas).map(name => ({
    name, signature: `${name}(...)`, description: 'Global formula defined in this project.', returnType: 'any', insert: `${name}(`,
  }));

  const allCategories = q
    ? null  // when searching, flatten all
    : null;
  void allCategories;

  const allFns = q
    ? Object.entries({ ...FUNCTION_LIBRARY, 'From Project': fromProject })
        .flatMap(([cat, fns]) => fns.filter(f => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)).map(f => ({ ...f, cat })))
    : null;

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {allFns ? (
        // Flat search results — fluid wrapping chips
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 10px' }}>
          {allFns.map(f => (
            <FnRow key={`${f.cat}:${f.name}`} fn={f} onInsertFn={onInsertFn} />
          ))}
        </div>
      ) : (
        // Categorized
        [...Object.entries(FUNCTION_LIBRARY), ['From Project', fromProject] as [string, FnDef[]]].map(([cat, fns]) => {
          const open = expandedCats.has(cat as string);
          return (
            <div key={cat as string}>
              <button
                onClick={() => toggleCat(cat as string)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '5px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #0f172a' }}
                onMouseEnter={ev => (ev.currentTarget.style.background = '#0f172a')}
                onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}
              >
                <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center' }}><FEChevron open={open} size={8} /></span>
                <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600, letterSpacing: '0.04em' }}>{cat as string}</span>
                <span style={{ marginLeft: 'auto', fontSize: 9, color: '#374151' }}>{(fns as FnDef[]).length}</span>
              </button>
              {open && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '6px 10px 8px' }}>
                  {(fns as FnDef[]).map(f => (
                    <FnRow key={f.name} fn={f} onInsertFn={onInsertFn} />
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export function FnRow({ fn, onInsertFn }: { fn: FnDef; onInsertFn: (fnInsert: string, signature: string) => void }) {
  return (
    <Tooltip text={`${fn.signature}\n\n${fn.description}\nReturns: ${fn.returnType}`}>
      <button
        onClick={() => onInsertFn(fn.insert, fn.signature)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '2px 7px',
          background: '#1f2937', border: '1px solid #374151', borderRadius: 12,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
        onMouseEnter={ev => { ev.currentTarget.style.borderColor = '#818cf8'; ev.currentTarget.style.background = '#2e1065'; }}
        onMouseLeave={ev => { ev.currentTarget.style.borderColor = '#374151'; ev.currentTarget.style.background = '#1f2937'; }}
      >
        <span style={{ fontSize: 9, color: '#a78bfa', fontStyle: 'italic' }}>ƒ</span>
        <span style={{ fontSize: 11, color: '#e2e8f0' }}>{fn.name}</span>
      </button>
    </Tooltip>
  );
}

// ─── EVENT_SHAPES — trigger → event preview object ───────────────────────────

/**
 * Preview shapes for each trigger type used in the formula editor Quick tab.
 * These match the runtime shapes produced by normalizeEvent in action-binding.ts.
 */
export const EVENT_SHAPES: Record<string, Record<string, unknown>> = {
  // Input/value triggers — event.value is the new value
  change:                { value: '' },
  initValueChange:       { value: '' },
  enterKey:              { value: '', key: 'Enter' },
  valueChange:           { value: false },
  focus:                 { value: '' },
  blur:                  { value: '' },
  submit:                { formData: {} },
  submitValidationError: { errors: {} },
  // Mouse triggers
  click:                 { x: 0, y: 0, button: 0 },
  doubleClick:           { x: 0, y: 0, button: 0 },
  rightClick:            { x: 0, y: 0, button: 2 },
  mouseDown:             { x: 0, y: 0, button: 0 },
  mouseUp:               { x: 0, y: 0, button: 0 },
  mouseMove:             { x: 0, y: 0 },
  mouseEnter:            { x: 0, y: 0 },
  mouseLeave:            { x: 0, y: 0 },
  // Touch triggers
  touchStart:            { touches: [{ x: 0, y: 0 }] },
  touchMove:             { touches: [{ x: 0, y: 0 }] },
  touchEnd:              { changedTouches: [{ x: 0, y: 0 }] },
  touchCancel:           { changedTouches: [{ x: 0, y: 0 }] },
  // Scroll
  scroll:                { scrollTop: 0, scrollLeft: 0 },
  // Lifecycle — no event payload
  created:               {},
  mounted:               {},
  beforeUnmount:         {},
};

// ─── EventContextSection ─────────────────────────────────────────────────────

/**
 * Renders an "Event" section in the Quick tab of the formula editor.
 * Shows the event shape for the active workflow trigger with clickable fields
 * that insert `event?.['fieldName']` formula chips (orange colour).
 */
export function EventContextSection({
  trigger,
  onInsert,
}: {
  trigger: string;
  onInsert: (formula: string, label: string, type?: VarRowItem['type']) => void;
}) {
  const shape = EVENT_SHAPES[trigger];
  if (!shape || Object.keys(shape).length === 0) return null;

  const [open, setOpen] = useState(true);

  return (
    <div style={{ borderBottom: '1px solid #1f2937' }}>
      {/* Section header */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: open ? '1px solid #1f2937' : 'none',
        }}
        onMouseEnter={ev => (ev.currentTarget.style.background = '#0f172a')}
        onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}
      >
        <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center' }}>
          <FEChevron open={open} size={8} />
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#fb923c', letterSpacing: '0.04em' }}>
          Event
        </span>
        <span style={{ marginLeft: 4, fontSize: 9, color: '#6b7280', fontFamily: 'monospace' }}>
          ({trigger})
        </span>
      </button>

      {open && (
        <div style={{ paddingBottom: 4 }}>
          {renderEventFields(shape, 'event', trigger, onInsert)}
        </div>
      )}
    </div>
  );
}

/** Recursively render event shape fields as clickable chips. */
function renderEventFields(
  obj: Record<string, unknown>,
  pathPrefix: string,
  labelPrefix: string,
  onInsert: (formula: string, label: string, type?: VarRowItem['type']) => void,
  depth = 0,
) {
  return Object.entries(obj).map(([key, val]) => {
    const formula = buildEventFormula(pathPrefix, key);
    const label = `${labelPrefix}.${key}`;
    const isObject = val !== null && typeof val === 'object' && !Array.isArray(val);
    const isArray  = Array.isArray(val) && val.length > 0 && typeof val[0] === 'object';

    return (
      <div key={key} style={{ paddingLeft: 12 + depth * 12 }}>
        {isObject ? (
          <EventFieldGroup
            fieldKey={key}
            obj={val as Record<string, unknown>}
            pathPrefix={formula}
            labelPrefix={label}
            onInsert={onInsert}
            depth={depth}
          />
        ) : isArray ? (
          <EventFieldGroup
            fieldKey={key}
            obj={(val as Record<string, unknown>[])[0]}
            pathPrefix={`${formula}?.[0]`}
            labelPrefix={`${label}[0]`}
            onInsert={onInsert}
            depth={depth}
            arrayHint={`[${(val as unknown[]).length}]`}
          />
        ) : (
          <button
            onClick={() => onInsert(formula, label, 'event')}
            title={formula}
            data-testid={`event-field-${key}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, width: '100%',
              padding: '2px 4px 2px 0', background: 'none', border: 'none',
              cursor: 'pointer', textAlign: 'left',
            }}
            onMouseEnter={ev => (ev.currentTarget.style.background = '#1f2937')}
            onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}
          >
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.4)',
              borderRadius: 4, padding: '1px 6px', fontSize: 10, fontFamily: 'monospace',
              color: '#fb923c', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              {key}
              <span style={{ color: '#6b7280', fontSize: 9 }}>
                {typeof val === 'string' ? 'str' : typeof val === 'number' ? 'num' : typeof val === 'boolean' ? 'bool' : ''}
              </span>
            </span>
          </button>
        )}
      </div>
    );
  });
}

function buildEventFormula(pathPrefix: string, key: string): string {
  return `${pathPrefix}?.['${key}']`;
}

function EventFieldGroup({
  fieldKey,
  obj,
  pathPrefix,
  labelPrefix,
  onInsert,
  depth,
  arrayHint,
}: {
  fieldKey: string;
  obj: Record<string, unknown>;
  pathPrefix: string;
  labelPrefix: string;
  onInsert: (formula: string, label: string, type?: VarRowItem['type']) => void;
  depth: number;
  arrayHint?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, width: '100%',
          padding: '2px 4px 2px 0', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
        onMouseEnter={ev => (ev.currentTarget.style.background = '#1f2937')}
        onMouseLeave={ev => (ev.currentTarget.style.background = 'none')}
      >
        <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center' }}>
          <FEChevron open={open} size={7} />
        </span>
        <span style={{ fontSize: 10, color: '#fb923c', fontFamily: 'monospace' }}>
          {fieldKey}{arrayHint ? arrayHint : ''}
        </span>
      </button>
      {open && (
        <div style={{ paddingLeft: 8 }}>
          {renderEventFields(obj, pathPrefix, labelPrefix, onInsert, depth + 1)}
        </div>
      )}
    </div>
  );
}

// ─── PopupContextSection ─────────────────────────────────────────────────────
// Shown in the "Quick" tab when the selected node is inside a popup being edited.
// Renders three groups matching the WeWeb design:
//   PROPERTIES — one chip per defined popup property  → context.component?.props?.['<id>']
//   LOCAL       — instancesCount / index / totalCount  → context.local.data?.['popup']?.['index']
//   INSTANCE    — thisInstance (runtime props object)  → context.local.data?.['popup']?.['props']

// Amber — matches CHIP_STYLE.popup in _formula-editor-dom.ts
const POPUP_CHIP = { bg: '#78350f', border: '#d97706', text: '#fde68a' };

function PopupPropChip({
  icon, label, value, onInsert, formula,
}: {
  icon: string; label: string; value?: unknown;
  formula: string;
  onInsert: (f: string, l: string, t: VarRowItem['type']) => void;
}) {
  const displayVal = value === undefined ? undefined
    : typeof value === 'object' ? JSON.stringify(value)
    : String(value);

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px 3px 22px', cursor: 'default' }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#0f1929')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      <span
      onClick={() => onInsert(formula, label, 'popup')}
      title={formula}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: POPUP_CHIP.bg, border: `1px solid ${POPUP_CHIP.border}`,
          borderRadius: 4, padding: '1px 6px', cursor: 'pointer', userSelect: 'none',
          fontSize: 11, color: POPUP_CHIP.text, fontWeight: 500,
        }}
      >
        <span style={{ fontSize: 9, opacity: 0.8 }}>{icon}</span>
        {label}
      </span>
      {displayVal !== undefined && (
        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
          {displayVal}
        </span>
      )}
    </div>
  );
}

function PopupSectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
    >
      <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center' }}><FEChevron open={open} size={8} /></span>
      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</span>
    </button>
  );
}

export function PopupContextSection({
  onInsert,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
}) {
  const editingPopupId = useBuilderStore(s => s.editingPopupId);
  const editingPopupModelsMap = useBuilderStore(s => s.editingPopupModelsMap);

  const [propsOpen, setPropsOpen] = useState(true);
  const [localOpen, setLocalOpen] = useState(true);

  const popupModel = useMemo(() => {
    if (!editingPopupId) return null;
    // Prefer fresh in-memory model (captures renames done while popup is open)
    const live = getPopups()[editingPopupId];
    return live ?? (editingPopupModelsMap[editingPopupId] as { properties?: Array<{ id: string; name: string; defaultValue?: unknown }> } | undefined) ?? null;
  }, [editingPopupId, editingPopupModelsMap]);

  if (!popupModel) return null;

  const properties = (popupModel as { properties?: Array<{ id: string; name: string; defaultValue?: unknown }> }).properties ?? [];

  return (
    <div style={{ borderTop: '1px solid #1f2937' }}>
      {/* PROPERTIES */}
      <PopupSectionHeader label="Properties" open={propsOpen} onToggle={() => setPropsOpen(o => !o)} />
      {propsOpen && (
        <div style={{ paddingBottom: 4 }}>
          {properties.length === 0 ? (
            <div style={{ padding: '2px 22px 6px', fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>No properties defined</div>
          ) : properties.map(prop => (
            <PopupPropChip
              key={prop.id}
              icon="T"
              label={prop.name}
              value={prop.defaultValue}
              formula={`context.component?.props?.['${prop.id}']`}
              onInsert={onInsert}
            />
          ))}
        </div>
      )}

      {/* LOCAL */}
      <PopupSectionHeader label="Local" open={localOpen} onToggle={() => setLocalOpen(o => !o)} />
      {localOpen && (
        <div style={{ paddingBottom: 4 }}>
          {[
            { icon: '#', label: 'instancesCount', value: 1,   formula: `context.local.data?.['popup']?.['instancesCount']` },
            { icon: '#', label: 'index',           value: 0,   formula: `context.local.data?.['popup']?.['index']` },
            { icon: '#', label: 'totalCount',      value: 1,   formula: `context.local.data?.['popup']?.['totalCount']` },
          ].map(item => (
            <PopupPropChip key={item.label} icon={item.icon} label={item.label} value={item.value} formula={item.formula} onInsert={onInsert} />
          ))}
        </div>
      )}

    </div>
  );
}
