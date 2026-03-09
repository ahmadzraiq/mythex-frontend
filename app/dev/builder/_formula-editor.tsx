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

// ─── JSON syntax highlighter ──────────────────────────────────────────────────
function highlightJson(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    match => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `<span style="color:#93c5fd">${match}</span>`; // key — blue
        return `<span style="color:#fcd34d">${match}</span>`;                       // string — amber
      }
      if (/true|false/.test(match)) return `<span style="color:#86efac">${match}</span>`; // bool — green
      if (/null/.test(match))       return `<span style="color:#6b7280">${match}</span>`; // null — gray
      return `<span style="color:#67e8f9">${match}</span>`;                              // number — cyan
    },
  );
}

// ─── Contenteditable formula editor helpers ───────────────────────────────────

/** Build the canonical formula path for a collection reference, e.g. collections['UUID']?.['data']?.[0] */
function buildFormulaPath(uuid: string, segments: Array<string | number>): string {
  let path = `collections['${uuid}']`;
  for (const seg of segments) {
    path += typeof seg === 'number' ? `?.[${seg}]` : `?.['${seg}']`;
  }
  return path;
}

/** Build the human-readable display label for a chip, e.g. "Featured Products.data[0]" */
function buildDisplayLabel(collectionLabel: string, segments: Array<string | number>): string {
  let label = collectionLabel;
  for (const seg of segments) {
    label += typeof seg === 'number' ? `[${seg}]` : `.${seg}`;
  }
  return label;
}

/**
 * Parse a DataTreeNode path (e.g. "storeKey.field[0].name") into
 * { formulaPath: "collections['UUID']?.['field']?.[0]?.['name']", displayLabel: "Label.field[0].name" }
 */
function pathToFormulaAndDisplay(
  nodePath: string,
  storeKey: string,
  displayName: string,
): { formulaPath: string; displayLabel: string } {
  const rest = nodePath.slice(storeKey.length); // e.g. ".field[0].name" or "[0].field"
  const segments: Array<string | number> = [];
  let rem = rest;
  while (rem.length > 0) {
    if (rem.startsWith('.')) {
      rem = rem.slice(1);
      const m = rem.match(/^([^.[]+)(.*)/);
      if (m) { segments.push(m[1]); rem = m[2]; } else break;
    } else if (rem.startsWith('[')) {
      const m = rem.match(/^\[(\d+)\](.*)/);
      if (m) { segments.push(Number(m[1])); rem = m[2]; } else break;
    } else break;
  }
  return {
    formulaPath: buildFormulaPath(storeKey, segments),
    displayLabel: buildDisplayLabel(displayName, segments),
  };
}

/** Serialize a contenteditable div to a formula string. */
function serializeEditor(el: HTMLElement): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Strip zero-width spaces (used as invisible cursor guards between chips)
      out += (node.textContent ?? '').replace(/\u200b/g, '');
    } else if (node instanceof HTMLElement && node.dataset.formula) {
      out += node.dataset.formula;
    }
  }
  return out;
}

/**
 * Fix up contenteditable quirks that appear when backspacing next to a
 * `contentEditable=false` chip:
 *   • Remove stray <br> elements the browser inserts to "hold" the cursor
 *   • Unwrap stray <div>/<p> block wrappers (causes chips to jump to new line)
 *   • Ensure a zero-width space (ZWS) text node exists between every two
 *     adjacent non-editable chips so the browser always has a real text node
 *     to place the cursor in (prevents future BRs)
 */
function normalizeEditorContent(editorEl: HTMLElement): void {
  // Pass 1: remove <br> and flatten <div>/<p> blocks
  let child = editorEl.firstChild;
  while (child) {
    const next = child.nextSibling;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName === 'BR') {
        editorEl.removeChild(el);
      } else if ((el.tagName === 'DIV' || el.tagName === 'P') && !el.dataset.type && !el.dataset.formula) {
        // Move the block's children directly into the editor, then remove the block
        while (el.firstChild) editorEl.insertBefore(el.firstChild, el);
        editorEl.removeChild(el);
      }
    }
    child = next;
  }

  // Pass 2: insert a ZWS guard between every pair of adjacent non-editable chips
  const children = Array.from(editorEl.childNodes);
  for (let i = 0; i < children.length - 1; i++) {
    const curr = children[i];
    const next = children[i + 1];
    const currIsChip = curr.nodeType === Node.ELEMENT_NODE && (curr as HTMLElement).contentEditable === 'false';
    const nextIsChip = next.nodeType === Node.ELEMENT_NODE && (next as HTMLElement).contentEditable === 'false';
    if (currIsChip && nextIsChip) {
      editorEl.insertBefore(document.createTextNode('\u200b'), next);
    }
  }
}

/**
 * Serialize only the selected portion of a contenteditable editor to a formula string.
 * Used by the copy handler so clipboard gets the raw formula, not display labels.
 */
function serializeRangeFromEditor(editorEl: HTMLElement, sel: Selection): string {
  if (!sel.rangeCount) return '';
  const range = sel.getRangeAt(0);
  let out = '';
  for (const node of editorEl.childNodes) {
    if (!range.intersectsNode(node)) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = (node.textContent ?? '').replace(/\u200b/g, '');
      // Compute which portion of this text node is selected
      const nodeRange = document.createRange();
      nodeRange.selectNode(node);
      const start = range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0
        ? 0 : range.startOffset;
      const end = range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0
        ? txt.length : range.endOffset;
      out += txt.slice(start, end);
    } else if (node instanceof HTMLElement && node.dataset.formula) {
      out += node.dataset.formula;
    }
  }
  return out;
}

/**
 * Parse a raw formula string and insert the resulting chips + text nodes at the
 * current caret position in the editor. Used by the paste handler.
 */
function insertPastedFormulaAtCaret(
  editorEl: HTMLElement,
  text: string,
  dsMap: Map<string, { label: string }>,
  varMap?: Map<string, { label: string }>,
): void {
  // Parse into a temp container then transplant children to the caret position
  const temp = document.createElement('div');
  populateEditor(temp, text, dsMap, varMap);

  editorEl.focus();
  const sel = window.getSelection();
  if (!sel?.rangeCount) {
    while (temp.firstChild) editorEl.appendChild(temp.firstChild);
    return;
  }
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.commonAncestorContainer)) {
    const r = document.createRange();
    r.selectNodeContents(editorEl); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }
  sel.getRangeAt(0).deleteContents();
  const fragment = document.createDocumentFragment();
  while (temp.firstChild) fragment.appendChild(temp.firstChild);
  const insertRange = sel.getRangeAt(0);
  insertRange.insertNode(fragment);
  insertRange.collapse(false);
  sel.removeAllRanges(); sel.addRange(insertRange);
}

/**
 * CHIP_RE matches:
 *   collections['UUID'](?.['key'] | ?.[N])*
 *   variables['UUID'](?.['key'] | ?.[N])*
 *   context.item(?.['key'] | dot.notation)*  |  context.index  |  context.parent
 *   globalContext.browser(?.['key'])*  |  globalContext.screen(?.['key'])*
 *   pages['UUID'](?.['key'])*
 *   theme.(colors|sections|fonts)(?.['key'])*
 *   local.data(?.['key'])*   — weWeb-style FormContainer local state
 */
// context.item supports both optional-chaining (context.item?.['k']) and dot notation (context.item.a.b)
// theme supports both theme.colors?.['k'] and theme?.['colors']?.['k']
const CHIP_RE = /collections\['([^']+)'\](?:\?\.\['[^']*'\]|\?\.\[\d+\])*|variables\['([^']+)'\](?:\?\.\['[^']*'\]|\?\.\[\d+\])*|local\.data(?:\?\.\['[^']*'\]|\?\.\[\d+\]|\.[\w$]+)*|context\.(?:item|index|parent)(?:(?:\?\.\['[^']*'\]|\?\.\[\d+\])|(?:\.\w+))*|globalContext\.(?:browser|screen)(?:\?\.\['[^']*'\])*|pages\['[^']+'\](?:\?\.\['[^']*'\])*|theme(?:\.(?:colors|sections|fonts|radius)|\?\.\['(?:colors|sections|fonts|radius)'\])(?:\?\.\['[^']*'\]|\.\w+)*/g;

const CHIP_INNER_CSS = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;display:block';

const CHIP_STYLE: Record<string, string> = {
  collection: 'background:#1d4ed8;color:#bfdbfe;border:1px solid #2563eb',
  variable:   'background:#0f766e;color:#ccfbf1;border:1px solid #0d9488',
  context:    'background:#7c3aed;color:#e9d5ff;border:1px solid #8b5cf6',
  pages:      'background:#0e7490;color:#cffafe;border:1px solid #0891b2',
  theme:      'background:#b45309;color:#fef3c7;border:1px solid #d97706',
  form:       'background:#c2410c;color:#ffedd5;border:1px solid #ea580c',
};

/** Build a chip <span> element (not yet inserted into DOM). */
function buildChipSpan(
  formulaPath: string,
  displayLabel: string,
  type: 'collection' | 'variable' | 'context' | 'pages' | 'theme' | 'form',
): HTMLSpanElement {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.dataset.type = type;
  span.dataset.formula = formulaPath;
  const colors = CHIP_STYLE[type] ?? CHIP_STYLE.variable;
  span.style.cssText =
    colors + ';border-radius:5px;padding:2px 4px;display:inline-flex;align-items:center;gap:3px;font-size:11px;line-height:1.4;cursor:default;vertical-align:middle;margin:0 1px;font-family:monospace;font-weight:600';

  // Add color swatch for theme color chips
  if (type === 'theme' && formulaPath.includes("'colors'")) {
    const colorKeyMatch = formulaPath.match(/\?\.\['([^']+)'\]\s*$/);
    const colorKey = colorKeyMatch?.[1];
    const tc = (themeConfig as Record<string, unknown>).colors as Record<string, string> | undefined;
    const colorValue = colorKey && tc ? tc[colorKey] : undefined;
    if (colorValue) {
      const swatch = document.createElement('span');
      swatch.style.cssText = `width:10px;height:10px;border-radius:2px;background:${colorValue};border:1px solid rgba(255,255,255,0.2);flex-shrink:0;display:inline-block`;
      span.appendChild(swatch);
    }
  }

  const inner = document.createElement('span');
  inner.textContent = displayLabel;
  inner.setAttribute('title', displayLabel);
  inner.style.cssText = CHIP_INNER_CSS;
  span.appendChild(inner);
  return span;
}

/** Insert a chip span at the current caret position in the contenteditable div. */
function insertChipAtCaret(
  editorEl: HTMLElement,
  formulaPath: string,
  displayLabel: string,
  type: 'collection' | 'variable' | 'context' | 'pages' | 'theme' | 'form',
): void {
  editorEl.focus();
  const sel = window.getSelection();
  if (!sel?.rangeCount) {
    // No selection — append to end
    const span = buildChipSpan(formulaPath, displayLabel, type);
    editorEl.appendChild(span);
    const r = document.createRange();
    r.setStartAfter(span); r.collapse(true);
    sel?.removeAllRanges(); sel?.addRange(r);
    return;
  }
  const range = sel.getRangeAt(0);
  // Ensure caret is inside the editor
  if (!editorEl.contains(range.commonAncestorContainer)) {
    // Place caret at end
    const r = document.createRange();
    r.selectNodeContents(editorEl); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }
  sel.getRangeAt(0).deleteContents();
  const span = buildChipSpan(formulaPath, displayLabel, type);
  sel.getRangeAt(0).insertNode(span);
  const r = document.createRange();
  r.setStartAfter(span); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}

/** Insert plain text at the current caret position. */
function insertPlainTextAtCaret(editorEl: HTMLElement, text: string): void {
  editorEl.focus();
  const sel = window.getSelection();
  if (!sel?.rangeCount) {
    // Append text node to end
    editorEl.appendChild(document.createTextNode(text));
    return;
  }
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.commonAncestorContainer)) {
    const r = document.createRange();
    r.selectNodeContents(editorEl); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }
  sel.getRangeAt(0).deleteContents();
  const textNode = document.createTextNode(text);
  sel.getRangeAt(0).insertNode(textNode);
  const r = document.createRange();
  r.setStartAfter(textNode); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}

/** Build a chip span for a function name (violet, distinct from operators/variables). */
function buildFunctionChip(fnName: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.dataset.type = 'function';
  span.dataset.formula = fnName;
  span.style.cssText = 'background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:5px;padding:2px 4px;display:inline-flex;align-items:center;font-size:11px;line-height:1.4;cursor:default;font-family:monospace;font-weight:600;vertical-align:middle;margin:0 1px;max-width:160px';
  const inner = document.createElement('span');
  inner.textContent = fnName;
  inner.style.cssText = CHIP_INNER_CSS;
  span.appendChild(inner);
  return span;
}

/** Count how many comma separators to insert based on param count in a signature string. */
function countSignatureCommas(signature: string): number {
  const m = signature.match(/\(([^)]*)\)/);
  if (!m || !m[1].trim()) return 0;
  const inner = m[1].trim();
  if (!inner) return 0;
  // Variadic (...x) or mixed (a, ...x) — always show at least 1 comma
  if (inner.includes('...')) return Math.max(1, inner.split(',').length - 1);
  return Math.max(0, inner.split(',').length - 1);
}

/**
 * Insert a function as visual chips: [fnName] [(] [,]* [)]
 * Places cursor right after the ( chip so the user types the first argument.
 * `fnInsert` should end with `(`, e.g. `"ifEmpty("`.
 */
function insertFunctionChipsAtCaret(editorEl: HTMLElement, fnInsert: string, signature: string): void {
  const fnName = fnInsert.endsWith('(') ? fnInsert.slice(0, -1) : fnInsert;
  const nCommas = countSignatureCommas(signature);

  editorEl.focus();
  const sel = window.getSelection();

  // Ensure caret is inside the editor
  if (!sel?.rangeCount || !editorEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const r = document.createRange();
    r.selectNodeContents(editorEl); r.collapse(false);
    sel?.removeAllRanges(); sel?.addRange(r);
  }
  sel!.getRangeAt(0).deleteContents();

  // Insert chips in reverse order so each insertNode keeps the caret stable
  const range = sel!.getRangeAt(0);

  const closeChip = buildOperatorChip(')', ')', 'punct');
  range.insertNode(closeChip);

  for (let i = 0; i < nCommas; i++) {
    const commaChip = buildOperatorChip(',', ', ', 'punct');
    range.insertNode(commaChip);
  }

  const openChip = buildOperatorChip('(', '(', 'punct');
  range.insertNode(openChip);

  const fnChip = buildFunctionChip(fnName);
  range.insertNode(fnChip);

  // Place cursor right after the ( chip (before the first comma or close paren)
  const r = document.createRange();
  r.setStartAfter(openChip); r.collapse(true);
  sel!.removeAllRanges(); sel!.addRange(r);
}

/** Insert a colored operator chip at the current caret position. */
function insertOperatorChipAtCaret(editorEl: HTMLElement, label: string, insertValue: string, category: string): void {
  editorEl.focus();
  const sel = window.getSelection();
  const chip = buildOperatorChip(label, insertValue, category);
  if (!sel?.rangeCount) {
    editorEl.appendChild(chip);
    const r = document.createRange();
    r.setStartAfter(chip); r.collapse(true);
    sel?.removeAllRanges(); sel?.addRange(r);
    return;
  }
  const range = sel.getRangeAt(0);
  if (!editorEl.contains(range.commonAncestorContainer)) {
    const r = document.createRange();
    r.selectNodeContents(editorEl); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }
  sel.getRangeAt(0).deleteContents();
  sel.getRangeAt(0).insertNode(chip);
  const r = document.createRange();
  r.setStartAfter(chip); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}

/**
 * Populate a contenteditable div from a formula string.
 * Replaces all content; called on mount to restore existing bindings.
 */
/** Convert a dot-notation path to optional-chaining chip formula.
 *  Always generates "context.SCOPE_ROOT?.['field']?.['sub']" format to match CHIP_RE.
 *  e.g. "context.item.priceWithTax.__typename" → "context.item?.['priceWithTax']?.['__typename']"
 *       "$item.priceWithTax.value"              → "context.item?.['priceWithTax']?.['value']"
 *       "$index"                                → "context.index"
 */
function contextPathToChipFormula(path: string): string {
  let scopeRoot: string;    // "item" | "index" | "parent"
  let fieldParts: string[];

  if (path.startsWith('$item.')) {
    scopeRoot = 'item';
    fieldParts = path.slice(6).split('.').filter(Boolean);
  } else if (path === '$item') {
    return 'context.item';
  } else if (path === '$index' || path.startsWith('$index')) {
    return 'context.index';
  } else if (path.startsWith('$parent.')) {
    scopeRoot = 'parent';
    fieldParts = path.slice(8).split('.').filter(Boolean);
  } else if (path.startsWith('context.item.')) {
    scopeRoot = 'item';
    fieldParts = path.slice(13).split('.').filter(Boolean);
  } else if (path === 'context.item') {
    return 'context.item';
  } else if (path.startsWith('context.parent.')) {
    scopeRoot = 'parent';
    fieldParts = path.slice(15).split('.').filter(Boolean);
  } else if (path.startsWith('context.')) {
    // Generic fallback — split after "context."
    const rest = path.slice(8).split('.');
    scopeRoot = rest[0];
    fieldParts = rest.slice(1);
  } else {
    scopeRoot = 'item';
    fieldParts = path.split('.').filter(Boolean);
  }

  // Build: context.SCOPE_ROOT?.['field1']?.['field2']...
  const suffix = fieldParts.map(s => `?.['${s}']`).join('');
  return `context.${scopeRoot}${suffix}`;
}

function populateEditor(
  el: HTMLElement,
  formula: string,
  dsMap: Map<string, { label: string }>,
  varMap?: Map<string, { label: string }>,
): void {
  el.innerHTML = '';
  if (!formula) return;

  // Pre-process: convert template-style context vars to chip-compatible optional-chaining format.
  // {{context.item.xxx}} → context?.['item']?.['xxx']
  // {{$item.xxx}} → context?.['item']?.['xxx']  (legacy fallback)
  let processed = formula
    .replace(/\{\{(context\.[^}]+)\}\}/g, (_, path) => contextPathToChipFormula(path))
    .replace(/\{\{(\$item[^}]+)\}\}/g, (_, path) => contextPathToChipFormula(path))
    .replace(/\{\{(\$index)\}\}/g, () => "context?.['index']")
    .replace(/\{\{(\$parent\.[^}]+)\}\}/g, (_, path) => contextPathToChipFormula(path));

  // Also handle plain dot-notation context paths (single-var case, stripped of {{}} by storedValueToFormula)
  // e.g. "context.item.productName" → leave for CHIP_RE to match (already extended to handle dot notation)

  CHIP_RE.lastIndex = 0;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = CHIP_RE.exec(processed)) !== null) {
    // Text before match — tokenize for operator chips
    if (match.index > lastEnd) {
      appendTextWithOperatorChips(el, processed.slice(lastEnd, match.index));
    }
    let formulaPath = match[0];
    const collectionUUID = match[1];
    const variableUUID = match[2];

    if (collectionUUID) {
      const base = dsMap.get(collectionUUID)?.label ?? collectionUUID;
      const afterRoot = formulaPath.slice(`collections['${collectionUUID}']`.length);
      const segs: Array<string | number> = [];
      let rem = afterRoot;
      while (rem.length > 0) {
        const numM = rem.match(/^\?\.\[(\d+)\](.*)/);
        if (numM) { segs.push(Number(numM[1])); rem = numM[2]; continue; }
        const strM = rem.match(/^\?\.\['([^']+)'\](.*)/);
        if (strM) { segs.push(strM[1]); rem = strM[2]; continue; }
        break;
      }
      const displayLabel = buildDisplayLabel(base, segs);
      el.appendChild(buildChipSpan(formulaPath, displayLabel, 'collection'));
    } else if (variableUUID) {
      const base = varMap?.get(variableUUID)?.label ?? variableUUID;
      const afterRoot = formulaPath.slice(`variables['${variableUUID}']`.length);
      const segs: Array<string | number> = [];
      let rem = afterRoot;
      while (rem.length > 0) {
        const numM = rem.match(/^\?\.\[(\d+)\](.*)/);
        if (numM) { segs.push(Number(numM[1])); rem = numM[2]; continue; }
        const strM = rem.match(/^\?\.\['([^']+)'\](.*)/);
        if (strM) { segs.push(strM[1]); rem = strM[2]; continue; }
        break;
      }
      const displayLabel = buildDisplayLabel(base, segs);
      el.appendChild(buildChipSpan(formulaPath, displayLabel, 'variable'));
    } else if (formulaPath.startsWith('local.data')) {
      // Normalize dot-notation to optional-chaining so the chip stores a consistent path.
      // e.g. local.data.form.formData.username → local.data?.['form']?.['formData']?.['username']
      const after = formulaPath.slice('local.data'.length);
      let normalized: string;
      if (!after || after.startsWith("?.['")) {
        normalized = formulaPath; // already in optional-chaining format or bare local.data
      } else {
        // Plain dot notation: .form.formData.username
        normalized = 'local.data';
        for (const seg of after.slice(1).split('.')) {
          if (seg) normalized += `?.['${seg}']`;
        }
      }
      // Friendly display: local.data.form.formData.username
      const friendly = normalized
        .replace(/\?\.\['([^']+)'\]/g, '.$1')
        .replace(/\?\.\[(\d+)\]/g, '[$1]');
      el.appendChild(buildChipSpan(normalized, friendly, 'form'));
    } else if (formulaPath.startsWith('context.')) {
      // Convert dot-notation to optional-chaining for the stored formula path
      if (!formulaPath.includes("?.['")) {
        formulaPath = contextPathToChipFormula(formulaPath);
      }
      // Display label: strip "context." prefix so chips show "item.priceWithTax..." not "context.item.priceWithTax..."
      const friendly = formulaPath
        .replace(/^context\./, '')
        .replace(/\?\.\['([^']+)'\]/g, '.$1')
        .replace(/\?\.\[(\d+)\]/g, '[$1]');
      el.appendChild(buildChipSpan(formulaPath, friendly, 'context'));
    } else if (formulaPath.startsWith('globalContext.')) {
      const friendly = formulaPath
        .replace(/^globalContext\./, '')
        .replace(/\?\.\['([^']+)'\]/g, '.$1')
        .replace(/\?\.\[(\d+)\]/g, '[$1]');
      el.appendChild(buildChipSpan(formulaPath, friendly, 'context'));
    } else if (formulaPath.startsWith('pages[')) {
      const friendly = formulaPath.replace(/\?\.\['([^']+)'\]/g, '.$1').replace(/\?\.\[(\d+)\]/g, '[$1]');
      el.appendChild(buildChipSpan(formulaPath, friendly, 'pages'));
    } else if (formulaPath.startsWith('theme.') || formulaPath.startsWith('theme?.')) {
      // Detect category then show prefixed label, e.g. "Color - background", "Typography - heading", "Radius - sm"
      const categoryMatch = formulaPath.match(/theme\??\.?\[?'?(colors|sections|fonts|radius)'\]?\??/);
      const category = categoryMatch?.[1] ?? '';
      const prefix = category === 'colors' ? 'Color' : category === 'fonts' ? 'Typography' : category === 'radius' ? 'Radius' : category === 'sections' ? 'Section' : '';
      const lastKeyMatch = formulaPath.match(/\?\.\['([^']+)'\]\s*$/) ?? formulaPath.match(/\.(\w+)\s*$/);
      const leaf = lastKeyMatch?.[1] ?? formulaPath;
      const friendly = prefix ? `${prefix} - ${leaf}` : leaf;
      el.appendChild(buildChipSpan(formulaPath, friendly, 'theme'));
    }
    lastEnd = match.index + formulaPath.length;
  }

  // Remaining plain text — tokenize for operator chips
  if (lastEnd < processed.length) {
    appendTextWithOperatorChips(el, processed.slice(lastEnd));
  }

  // Ensure ZWS guards between adjacent chips so the cursor always has a
  // text node to sit in (prevents browser from inserting <br> on backspace)
  normalizeEditorContent(el);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'variables' | 'data' | 'formulas' | 'quick';

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

// ─── Function Library ─────────────────────────────────────────────────────────

interface FnDef {
  name: string;
  signature: string;
  description: string;
  returnType: string;
  insert: string; // text inserted into formula
}

const FUNCTION_LIBRARY: Record<string, FnDef[]> = {
  Conditional: [
    { name: 'if', signature: 'if(condition, value1, value2)', description: 'Returns value1 if condition is truthy, otherwise value2.', returnType: 'any', insert: 'if(' },
    { name: 'ifEmpty', signature: 'ifEmpty(value, fallback)', description: 'Returns value if it is not empty, otherwise returns fallback.', returnType: 'any', insert: 'ifEmpty(' },
    { name: 'not', signature: 'not(value)', description: 'Inverts a boolean — true becomes false, false becomes true.', returnType: 'boolean', insert: 'not(' },
    { name: 'switch', signature: 'switch(expression, case1, result1, ...default)', description: 'Tests expression against each case value and returns the matching result. Last argument is the default.', returnType: 'any', insert: 'switch(' },
  ],
  Math: [
    { name: 'average', signature: 'average(...values)', description: 'Returns the average of all provided numbers or array values.', returnType: 'number', insert: 'average(' },
    { name: 'rollupSum', signature: 'rollupSum(array, key)', description: 'Sums the value of a specific key across all objects in an array.', returnType: 'number', insert: 'rollupSum(' },
    { name: 'round', signature: 'round(number, precision?)', description: 'Rounds a number. Optional precision sets the number of decimal places (default 0).', returnType: 'number', insert: 'round(' },
    { name: 'sum', signature: 'sum(...values)', description: 'Sums all provided numbers or an array of numbers.', returnType: 'number', insert: 'sum(' },
    { name: 'toNumber', signature: 'toNumber(value)', description: 'Converts a string to a number.', returnType: 'number', insert: 'toNumber(' },
  ],
  Array: [
    { name: 'add', signature: 'add(array, ...values)', description: 'Adds one or more values to the end of an array (like push). Returns new array.', returnType: 'array', insert: 'add(' },
    { name: 'contains', signature: 'contains(array, value)', description: 'Returns true if value exists in the array.', returnType: 'boolean', insert: 'contains(' },
    { name: 'createArray', signature: 'createArray(...values)', description: 'Creates a new array from the provided values.', returnType: 'array', insert: 'createArray(' },
    { name: 'compare', signature: 'compare(array1, array2)', description: 'Returns true if both arrays have the same values in the same order.', returnType: 'boolean', insert: 'compare(' },
    { name: 'distinct', signature: 'distinct(array)', description: 'Returns a new array with duplicate values removed.', returnType: 'array', insert: 'distinct(' },
    { name: 'filterByKey', signature: 'filterByKey(array, key, value)', description: 'Returns only objects where array[key] equals value.', returnType: 'array', insert: 'filterByKey(' },
    { name: 'findIndex', signature: 'findIndex(array, value)', description: 'Returns the index of the first matching value, or -1 if not found.', returnType: 'number', insert: 'findIndex(' },
    { name: 'findIndexByKey', signature: 'findIndexByKey(array, key, value)', description: 'Returns the index of the first object where array[key] equals value.', returnType: 'number', insert: 'findIndexByKey(' },
    { name: 'getByIndex', signature: 'getByIndex(array, index)', description: 'Returns the element at the given index.', returnType: 'any', insert: 'getByIndex(' },
    { name: 'groupBy', signature: 'groupBy(array, key)', description: 'Groups array objects by the value of a given key. Returns grouped array.', returnType: 'array', insert: 'groupBy(' },
    { name: 'join', signature: 'join(array, separator?)', description: 'Joins all array elements into a string, separated by the given separator (default ",").', returnType: 'string', insert: 'join(' },
    { name: 'length', signature: 'length(array)', description: 'Returns the number of items in an array.', returnType: 'number', insert: 'length(' },
    { name: 'lookup', signature: 'lookup(array, value, key?)', description: 'Returns the first object where key equals value. Key defaults to "id".', returnType: 'object', insert: 'lookup(' },
    { name: 'lookupArray', signature: 'lookupArray(array, values, key)', description: 'Returns all objects where key is in the values array.', returnType: 'array', insert: 'lookupArray(' },
    { name: 'map', signature: 'map(array, key)', description: 'Returns an array containing only the value of key from each object.', returnType: 'array', insert: 'map(' },
    { name: 'merge', signature: 'merge(...arrays)', description: 'Merges two or more arrays into one.', returnType: 'array', insert: 'merge(' },
    { name: 'prepend', signature: 'prepend(array, ...values)', description: 'Adds values to the beginning of an array. Returns new array.', returnType: 'array', insert: 'prepend(' },
    { name: 'remove', signature: 'remove(array, value)', description: 'Removes the first occurrence of value from the array. Returns new array.', returnType: 'array', insert: 'remove(' },
    { name: 'removeByIndex', signature: 'removeByIndex(array, index)', description: 'Removes the element at the given index. Returns new array.', returnType: 'array', insert: 'removeByIndex(' },
    { name: 'removeByKey', signature: 'removeByKey(array, key, value)', description: 'Removes all objects where array[key] equals value. Returns new array.', returnType: 'array', insert: 'removeByKey(' },
    { name: 'reverse', signature: 'reverse(array)', description: 'Reverses the order of elements in an array.', returnType: 'array', insert: 'reverse(' },
    { name: 'rollup', signature: 'rollup(array, key, distinct?)', description: 'Returns an array of values for a given key from each object. Set distinct=true for unique values only.', returnType: 'array', insert: 'rollup(' },
    { name: 'slice', signature: 'slice(array, startIndex, endIndex?)', description: 'Returns a portion of an array from startIndex up to (but not including) endIndex.', returnType: 'array', insert: 'slice(' },
    { name: 'sort', signature: 'sort(array, order?, key?)', description: 'Sorts an array in "asc" or "desc" order. Provide key for arrays of objects.', returnType: 'array', insert: 'sort(' },
    { name: 'flat', signature: 'flat(array, depth?)', description: 'Flattens nested arrays into a single array up to the given depth (default 1).', returnType: 'array', insert: 'flat(' },
  ],
  Text: [
    { name: 'capitalize', signature: 'capitalize(text)', description: 'Capitalizes the first letter of each word in the string.', returnType: 'string', insert: 'capitalize(' },
    { name: 'concatenate', signature: 'concatenate(...values)', description: 'Joins multiple strings into one.', returnType: 'string', insert: 'concatenate(' },
    { name: 'contains', signature: 'contains(text, substring)', description: 'Returns true if substring exists within text.', returnType: 'boolean', insert: 'contains(' },
    { name: 'indexOf', signature: 'indexOf(text, substring)', description: 'Returns the position of substring in text, or -1 if not found.', returnType: 'number', insert: 'indexOf(' },
    { name: 'lower', signature: 'lower(text)', description: 'Converts a string to lowercase.', returnType: 'string', insert: 'lower(' },
    { name: 'split', signature: 'split(text, separator)', description: 'Splits a string into an array using the given separator.', returnType: 'array', insert: 'split(' },
    { name: 'subText', signature: 'subText(text, startIndex, endIndex?)', description: 'Returns part of a string from startIndex up to endIndex.', returnType: 'string', insert: 'subText(' },
    { name: 'textLength', signature: 'textLength(text)', description: 'Returns the number of characters in a string.', returnType: 'number', insert: 'textLength(' },
    { name: 'toText', signature: 'toText(value)', description: 'Converts a number, boolean, or array to a string.', returnType: 'string', insert: 'toText(' },
    { name: 'uppercase', signature: 'uppercase(text)', description: 'Converts a string to uppercase.', returnType: 'string', insert: 'uppercase(' },
  ],
  Object: [
    { name: 'createObject', signature: 'createObject(key1, value1, ...)', description: 'Creates an object from key-value pairs.', returnType: 'object', insert: 'createObject(' },
    { name: 'getKeyValue', signature: 'getKeyValue(object, key)', description: 'Returns the value for a given key in an object.', returnType: 'any', insert: 'getKeyValue(' },
    { name: 'compare', signature: 'compare(object1, object2)', description: 'Returns true if both objects have the same keys and values.', returnType: 'boolean', insert: 'compare(' },
    { name: 'keys', signature: 'keys(object)', description: 'Returns all keys of an object as an array.', returnType: 'array', insert: 'keys(' },
    { name: 'omit', signature: 'omit(object, ...keys)', description: 'Returns the object without the specified keys.', returnType: 'object', insert: 'omit(' },
    { name: 'pick', signature: 'pick(object, ...keys)', description: 'Returns a new object containing only the specified keys.', returnType: 'object', insert: 'pick(' },
    { name: 'setKeyValue', signature: 'setKeyValue(object, key, value)', description: 'Returns a new object with the given key set to value.', returnType: 'object', insert: 'setKeyValue(' },
    { name: 'values', signature: 'values(object)', description: 'Returns all values of an object as an array.', returnType: 'array', insert: 'values(' },
  ],
  Utils: [
    { name: 'toBool', signature: 'toBool(value)', description: 'Converts a value to boolean based on truthiness or falsiness.', returnType: 'boolean', insert: 'toBool(' },
  ],
  Format: [
    { name: 'formatCurrency', signature: 'formatCurrency(amount, currencyCode, locale?)', description: 'Formats a number as currency. amount is in the smallest unit (e.g. cents). currencyCode is e.g. "USD". Optional locale defaults to "en-US".', returnType: 'string', insert: 'formatCurrency(' },
    { name: 'formatDate', signature: 'formatDate(date, format?)', description: 'Formats a date string or timestamp. Optional format: "short", "long", "iso" (default "short").', returnType: 'string', insert: 'formatDate(' },
    { name: 'formatNumber', signature: 'formatNumber(number, decimals?, locale?)', description: 'Formats a number with decimal places and locale-aware separators.', returnType: 'string', insert: 'formatNumber(' },
  ],
  Validation: [
    { name: 'isEmail', signature: 'isEmail(value)', description: 'Returns true if value is a valid email address.', returnType: 'boolean', insert: 'isEmail(' },
    { name: 'isEmpty', signature: 'isEmpty(value)', description: 'Returns true if value is null, empty string, or empty array.', returnType: 'boolean', insert: 'isEmpty(' },
    { name: 'isNotEmpty', signature: 'isNotEmpty(value)', description: 'Returns true if value is not null, not empty string, and not empty array.', returnType: 'boolean', insert: 'isNotEmpty(' },
    { name: 'hasMinLength', signature: 'hasMinLength(value, n)', description: 'Returns true if value has at least n characters.', returnType: 'boolean', insert: 'hasMinLength(' },
    { name: 'hasMaxLength', signature: 'hasMaxLength(value, n)', description: 'Returns true if value has at most n characters.', returnType: 'boolean', insert: 'hasMaxLength(' },
    { name: 'isPhone', signature: 'isPhone(value)', description: 'Returns true if value looks like a valid phone number.', returnType: 'boolean', insert: 'isPhone(' },
    { name: 'isUrl', signature: 'isUrl(value)', description: 'Returns true if value is a valid URL.', returnType: 'boolean', insert: 'isUrl(' },
    { name: 'matchesPattern', signature: 'matchesPattern(value, pattern)', description: 'Returns true if value matches the given regular expression pattern.', returnType: 'boolean', insert: 'matchesPattern(' },
  ],
};

const OPERATORS: Array<{ label: string; insert: string; description: string; category: 'comparison' | 'logical' | 'math' | 'punct' }> = [
  // Comparison
  { label: '=',   insert: ' === ', description: 'Equal to (strict)',          category: 'comparison' },
  { label: '!=',  insert: ' !== ', description: 'Not equal to (strict)',      category: 'comparison' },
  { label: '>=',  insert: ' >= ',  description: 'Greater than or equal to',   category: 'comparison' },
  { label: '<=',  insert: ' <= ',  description: 'Less than or equal to',      category: 'comparison' },
  { label: '>',   insert: ' > ',   description: 'Greater than',               category: 'comparison' },
  { label: '<',   insert: ' < ',   description: 'Less than',                  category: 'comparison' },
  // Logical
  { label: 'and', insert: ' && ',  description: 'Logical AND — true only if both sides are true', category: 'logical' },
  { label: 'or',  insert: ' || ',  description: 'Logical OR — true if at least one side is true', category: 'logical' },
  // Math
  { label: '+',   insert: ' + ',   description: 'Addition or string concatenation', category: 'math' },
  { label: '-',   insert: ' - ',   description: 'Subtraction',                category: 'math' },
  { label: '*',   insert: ' * ',   description: 'Multiplication',             category: 'math' },
  { label: '/',   insert: ' / ',   description: 'Division',                   category: 'math' },
  { label: 'mod', insert: ' % ',   description: 'Modulo — remainder of division', category: 'math' },
  // Punctuation helpers
  { label: '(',   insert: '(',     description: 'Open parenthesis',           category: 'punct' },
  { label: ')',   insert: ')',     description: 'Close parenthesis',          category: 'punct' },
  { label: ',',   insert: ', ',    description: 'Argument separator',         category: 'punct' },
];

const OP_CHIP = { bg: '#1e293b', border: '#334155', color: '#94a3b8', hoverBg: '#334155' };

const OP_STYLE: Record<string, { bg: string; border: string; color: string; hoverBg: string }> = {
  comparison: OP_CHIP,
  logical:    OP_CHIP,
  math:       OP_CHIP,
  punct:      OP_CHIP,
};

// ─── Operator chip helpers (need OPERATORS + OP_STYLE defined above) ──────────

/** Build a colored chip span for an operator (comparison / logical / math / punct). */
function buildOperatorChip(label: string, insertValue: string, category: string): HTMLSpanElement {
  const s = OP_STYLE[category] ?? OP_STYLE.punct;
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.dataset.type = 'operator';
  span.dataset.category = category;
  span.dataset.formula = insertValue;
  span.style.cssText = `background:${s.bg};color:${s.color};border:1px solid ${s.border};border-radius:5px;padding:2px 4px;display:inline-flex;align-items:center;font-size:11px;line-height:1.4;cursor:default;font-family:monospace;font-weight:600;vertical-align:middle;margin:0 1px`;
  const inner = document.createElement('span');
  inner.textContent = label;
  inner.style.cssText = 'white-space:nowrap';
  span.appendChild(inner);
  return span;
}

/**
 * Regex that matches any operator insert string (longest first so ' !== ' wins over ' != ').
 */
const OP_TOKEN_RE = new RegExp(
  OPERATORS
    .map(op => op.insert.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|'),
  'g',
);

/** Map from insert value → operator definition, used by populateEditor. */
const OP_INSERT_MAP = new Map(OPERATORS.map(op => [op.insert, op]));

/**
 * Regex that matches the RAW typed forms of ALL operators (no surrounding spaces).
 * Ordered longest-first so `!==` wins over `!=`, `===` over `==`, `>=` over `>`, etc.
 * Used by rechipCurrentTextNode to auto-chip as the user types.
 */
const AUTO_CHIP_RE = /===|!==|>=|<=|&&|\|\||\(|\)|,|\+|\*|\/|%|-|>|</g;

/**
 * Maps every raw typed operator token to its OPERATORS entry so we can build
 * the correct chip with the right label, insert value, and category.
 */
const AUTO_CHIP_TYPED_MAP: Record<string, { label: string; insert: string; category: string }> = {
  '===': { label: '=',   insert: ' === ', category: 'comparison' },
  '!==': { label: '!=',  insert: ' !== ', category: 'comparison' },
  '>=':  { label: '>=',  insert: ' >= ',  category: 'comparison' },
  '<=':  { label: '<=',  insert: ' <= ',  category: 'comparison' },
  '>':   { label: '>',   insert: ' > ',   category: 'comparison' },
  '<':   { label: '<',   insert: ' < ',   category: 'comparison' },
  '&&':  { label: 'and', insert: ' && ',  category: 'logical'    },
  '||':  { label: 'or',  insert: ' || ',  category: 'logical'    },
  '+':   { label: '+',   insert: ' + ',   category: 'math'       },
  '-':   { label: '-',   insert: ' - ',   category: 'math'       },
  '*':   { label: '*',   insert: ' * ',   category: 'math'       },
  '/':   { label: '/',   insert: ' / ',   category: 'math'       },
  '%':   { label: 'mod', insert: ' % ',   category: 'math'       },
  '(':   { label: '(',   insert: '(',     category: 'punct'      },
  ')':   { label: ')',   insert: ')',     category: 'punct'      },
  ',':   { label: ',',   insert: ', ',   category: 'punct'      },
};

/**
 * After each input event, scan the text node that contains the cursor and
 * convert any complete operator tokens (typed forms) to colored chips.
 * Cursor is repositioned to the equivalent location in the new DOM structure.
 * Returns true if any conversion happened.
 */
function rechipCurrentTextNode(editorEl: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const container = range.startContainer;

  // Only process text nodes that are direct children of the editor
  if (container.nodeType !== Node.TEXT_NODE || container.parentNode !== editorEl) return false;

  const text = container.textContent ?? '';
  AUTO_CHIP_RE.lastIndex = 0;
  if (!AUTO_CHIP_RE.test(text)) return false;
  AUTO_CHIP_RE.lastIndex = 0;

  const cursorOffset = range.startOffset;

  // Build replacement node list, tracking source-text consumed per segment
  type Seg = { node: Node; srcLen: number };
  const segments: Seg[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = AUTO_CHIP_RE.exec(text)) !== null) {
    const beforeText = text.slice(lastEnd, m.index);

    // Special case: when `(` is typed, check if a function name immediately precedes it.
    // If so, chip the function name first, then chip `(`.  Function names are only auto-
    // chipped when followed by `(` — typing the name alone does nothing.
    if (m[0] === '(' && beforeText) {
      const fnMatch = FN_NAME_SUFFIX_RE.exec(beforeText);
      if (fnMatch) {
        const fnStart = fnMatch.index + (fnMatch[0].length - fnMatch[1].length);
        const textBeforeFn = beforeText.slice(0, fnStart);
        if (textBeforeFn) segments.push({ node: document.createTextNode(textBeforeFn), srcLen: textBeforeFn.length });
        segments.push({ node: buildFunctionChip(fnMatch[1]), srcLen: fnMatch[1].length });
        segments.push({ node: buildOperatorChip('(', '(', 'punct'), srcLen: 1 });
        lastEnd = m.index + 1;
        continue;
      }
    }

    if (beforeText) {
      segments.push({ node: document.createTextNode(beforeText), srcLen: beforeText.length });
    }
    const def = AUTO_CHIP_TYPED_MAP[m[0]];
    if (def) {
      segments.push({ node: buildOperatorChip(def.label, def.insert, def.category), srcLen: m[0].length });
    } else {
      segments.push({ node: document.createTextNode(m[0]), srcLen: m[0].length });
    }
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    segments.push({ node: document.createTextNode(text.slice(lastEnd)), srcLen: text.length - lastEnd });
  }

  // Locate new cursor position by walking segments and counting source chars
  let consumed = 0;
  let newCursorNode: Node | null = null;
  let newCursorOffset = 0;
  let useAfter = false;

  for (const seg of segments) {
    const segEnd = consumed + seg.srcLen;
    if (newCursorNode === null && cursorOffset <= segEnd) {
      if (seg.node.nodeType === Node.TEXT_NODE) {
        newCursorNode = seg.node;
        newCursorOffset = Math.min(cursorOffset - consumed, seg.node.textContent?.length ?? 0);
      } else {
        // Cursor was inside/after an operator match → place after the chip
        newCursorNode = seg.node;
        useAfter = true;
      }
    }
    consumed = segEnd;
  }

  // Replace original text node with the new segments
  const parent = container.parentNode!;
  const nextSibling = container.nextSibling;
  parent.removeChild(container);
  for (const seg of segments) {
    if (nextSibling) parent.insertBefore(seg.node, nextSibling);
    else parent.appendChild(seg.node);
  }

  // Restore caret
  if (newCursorNode) {
    const r = document.createRange();
    if (useAfter) {
      r.setStartAfter(newCursorNode);
    } else {
      r.setStart(newCursorNode, newCursorOffset);
    }
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  return true;
}

/**
 * Set of all built-in function names — used to chip-ify function names on paste.
 * Defined after FUNCTION_LIBRARY so all categories are available.
 */
const KNOWN_FN_NAMES = new Set(
  Object.values(FUNCTION_LIBRARY).flatMap(fns => fns.map(f => f.name))
);

/**
 * Regex that splits a plain-text segment into function-name tokens and everything else.
 *
 * Uses `(?<![a-zA-Z_$])` (negative lookbehind) instead of `\b` so that function names
 * preceded by a digit are still matched — e.g. `2ifEmpty` restores as
 * `[text "2"][ifEmpty chip]` after undo/redo.  `\b` would fail here because both `2`
 * and `i` are `\w`, so there is no word boundary between them.
 *
 * The suffix guard `(?![a-zA-Z_$0-9])` prevents partial matches like `someifEmpty`.
 */
const FN_NAME_RE = new RegExp(
  '(?<![a-zA-Z_$])(' + [...KNOWN_FN_NAMES].sort((a, b) => b.length - a.length).join('|') + ')(?![a-zA-Z_$0-9])',
  'g',
);

/**
 * Regex that matches a known function name at the END of a string.
 * Used by rechipCurrentTextNode: when the user types `(`, we look backwards for a
 * function name immediately preceding the `(` and chip it as a function chip.
 * Same lookbehind as FN_NAME_RE — allows `2ifEmpty(` to chip `ifEmpty` after `2`.
 */
const FN_NAME_SUFFIX_RE = new RegExp(
  '(?<![a-zA-Z_$])(' + [...KNOWN_FN_NAMES].sort((a, b) => b.length - a.length).join('|') + ')$',
);

/** Append a plain text segment, chip-ifying any recognized function names. */
function appendTextSegment(el: HTMLElement, text: string): void {
  if (!text) return;
  FN_NAME_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = FN_NAME_RE.exec(text)) !== null) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    el.appendChild(buildFunctionChip(m[1]));
    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

/**
 * Append text to `el`, splitting recognized operator tokens into colored chips,
 * function names into function chips, and leaving everything else as plain text.
 */
function appendTextWithOperatorChips(el: HTMLElement, text: string): void {
  if (!text) return;
  OP_TOKEN_RE.lastIndex = 0;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = OP_TOKEN_RE.exec(text)) !== null) {
    if (m.index > lastEnd) {
      appendTextSegment(el, text.slice(lastEnd, m.index));
    }
    const opDef = OP_INSERT_MAP.get(m[0]);
    if (opDef) {
      el.appendChild(buildOperatorChip(opDef.label, opDef.insert, opDef.category));
    } else {
      el.appendChild(document.createTextNode(m[0]));
    }
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    appendTextSegment(el, text.slice(lastEnd));
  }
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
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
interface VarRowItem {
  formulaPath: string;
  displayLabel: string;
  type: 'variable' | 'context' | 'pages' | 'theme' | 'form';
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

function VariableEntry({
  variable,
  liveValue,
  onInsert,
  search,
}: {
  variable: import('./_store').CustomVar;
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
/** Top-level controlled components (Input wraps InputField; we show Input not InputField) */
const STANDALONE_CONTROLLED_TYPES = new Set(['Input', 'Textarea', 'Checkbox', 'Select']);

/** Extract field names from a FormContainer's subtree (setFormField actions or initialFormData) */
function extractFormFieldNames(formNode: { props?: { initialFormData?: Record<string, unknown> }; children?: Array<{ type?: string; actions?: Record<string, unknown>; props?: Record<string, unknown>; children?: unknown[] }> }): string[] {
  const fromInitial = formNode.props?.initialFormData ? Object.keys(formNode.props.initialFormData) : [];
  const fromActions = new Set<string>();
  function walk(nodes: unknown[]) {
    for (const n of nodes || []) {
      const node = n as { type?: string; actions?: Record<string, unknown>; children?: unknown[] };
      for (const a of Object.values(node.actions ?? {})) {
        const action = Array.isArray(a) ? a[0] : a;
        if (action && typeof action === 'object' && (action as Record<string, unknown>).type === 'setFormField') {
          const f = (action as Record<string, unknown>).field;
          if (typeof f === 'string') fromActions.add(f);
        }
      }
      if (node.children?.length) walk(node.children);
    }
  }
  walk(formNode.children ?? []);
  return [...new Set([...fromInitial, ...fromActions])];
}

/** Check if node type is a top-level controlled component (for standalone listing) */
function isStandaloneControlled(type: string): boolean {
  return STANDALONE_CONTROLLED_TYPES.has(type);
}

/** Recursively collect FormContainers and standalone controlled components from page tree */
function collectPageComponents(
  nodes: import('./_store').SDUINode[],
  parentInsideForm: boolean
): { formContainers: Array<{ node: import('./_store').SDUINode; fields: string[] }>; standalones: import('./_store').SDUINode[] } {
  const formContainers: Array<{ node: import('./_store').SDUINode; fields: string[] }> = [];
  const standalones: import('./_store').SDUINode[] = [];
  for (const node of nodes) {
    const insideForm = parentInsideForm || node.type === 'FormContainer';
    if (node.type === 'FormContainer') {
      formContainers.push({ node, fields: extractFormFieldNames(node) });
    } else if (isStandaloneControlled(node.type as string) && !insideForm) {
      standalones.push(node);
    }
    if (node.children?.length) {
      const sub = collectPageComponents(node.children as import('./_store').SDUINode[], insideForm);
      formContainers.push(...sub.formContainers);
      standalones.push(...sub.standalones);
    }
  }
  return { formContainers, standalones };
}

function PageComponentsSection({
  onInsert,
  search,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
  search: string;
}) {
  const [open, setOpen] = useState(true);
  const pageNodes = useBuilderStore(s => s.pageNodes);
  const vsData = getGlobalVariableStore()(state => state.data);

  const { formContainers, standalones } = useMemo(
    () => collectPageComponents(pageNodes, false),
    [pageNodes]
  );

  const formState = useMemo(() => {
    const local = (vsData['local'] ?? {}) as Record<string, unknown>;
    const data = (local['data'] ?? {}) as Record<string, unknown>;
    return (data['form'] ?? { formData: {}, fields: {} }) as { formData: Record<string, unknown>; fields: Record<string, { value: unknown }> };
  }, [vsData]);

  const componentsData = (vsData['components'] ?? {}) as Record<string, Record<string, unknown>>;
  const lq = search.toLowerCase();

  const handleInsertForm = (subPath: string, label: string) => {
    const segs = subPath.split('.').filter(Boolean);
    let formula = 'local.data';
    for (const seg of segs) formula += `?.['${seg}']`;
    onInsert(formula, `local.data.${subPath}`, 'form');
  };

  const handleInsertComponent = (nodeId: string, subPath: string) => {
    const formula = `components?.['${nodeId}']?.['${subPath}']`;
    onInsert(formula, `components.${nodeId}.${subPath}`, 'form');
  };

  const hasAny = formContainers.length > 0 || standalones.length > 0;
  if (!hasAny) return null;

  const matchesSearch = (label: string) => !lq || label.toLowerCase().includes(lq);

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
        <span style={{ fontSize: 9, color: '#374151', marginLeft: 'auto' }}>{formContainers.length + standalones.length}</span>
      </button>
      {open && (
        <div style={{ paddingLeft: 8, paddingBottom: 8 }}>
          {formContainers.map(({ node, fields }) => {
            const label = ((node as { name?: string }).name || 'Form container').trim() || 'Form container';
            if (!matchesSearch(label) && !matchesSearch('form')) return null;
            return (
              <div key={node.id} style={{ paddingTop: 4 }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', cursor: 'pointer' }}
                  onClick={() => handleInsertForm('form', 'local.data.form')}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <ContextGroupPill icon="{}" label={label} bg={FORM_CC.bg} border={FORM_CC.border} textColor={FORM_CC.text} />
                </div>
                <div style={{ paddingLeft: 16 }}>
                  <div
                    onClick={() => handleInsertForm('form', 'local.data.form')}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 12px', cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <ContextGroupPill icon="{}" label="form" bg={FORM_CC.bg} border={FORM_CC.border} textColor={FORM_CC.text} />
                  </div>
                  {fields.map(fieldName => {
                    if (!matchesSearch(fieldName)) return null;
                    const val = formState.formData?.[fieldName];
                    const displayVal = val === undefined ? '""' : JSON.stringify(val);
                    return (
                      <div
                        key={fieldName}
                        onClick={() => handleInsertForm(`form.formData.${fieldName}`, `local.data.form.formData.${fieldName}`)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 12px 2px 28px', cursor: 'pointer' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                      >
                        <span style={{ background: FORM_CC.bg, color: FORM_CC.text, border: `1px solid ${FORM_CC.border}`, borderRadius: 5, padding: '1px 5px', fontSize: 10, fontWeight: 600, fontFamily: 'monospace' }}>
                          {fieldName}
                        </span>
                        <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace', marginLeft: 'auto' }}>{displayVal}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {standalones.map(node => {
            const nodeId = (node as { id?: string }).id;
            if (!nodeId) return null;
            const label = ((node as { name?: string }).name || node.type).trim() || 'Input';
            if (!matchesSearch(label)) return null;
            const valueNodeId = node.type === 'Input' || node.type === 'Textarea'
              ? ((node.children as { id?: string }[] | undefined)?.find((c: { type?: string }) => c.type === 'InputField' || c.type === 'TextareaInput')?.id ?? nodeId)
              : nodeId;
            const compData = componentsData[valueNodeId];
            const val = compData?.value;
            const displayVal = val === undefined ? '""' : JSON.stringify(val);
            return (
              <div
                key={nodeId}
                onClick={() => handleInsertComponent(valueNodeId, 'value')}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', cursor: 'pointer' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{ background: FORM_CC.bg, color: FORM_CC.text, border: `1px solid ${FORM_CC.border}`, borderRadius: 5, padding: '1px 5px', fontSize: 10, fontWeight: 600, fontFamily: 'monospace' }}>
                  {label}
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

function VariableTree({
  onSelect,
  search,
  customVars,
  varFolders,
}: {
  onSelect: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
  search: string;
  customVars: import('./_store').CustomVar[];
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
    const fm: Map<string, import('./_store').CustomVar[]> = new Map();
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

function FEChevron({ open, size = 8 }: { open: boolean; size?: number }) {
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

function DataTreeNode({
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

function CollectionEntry({ src, onInsert, search }: {
  src: DataSourceConfig;
  onInsert: (formulaPath: string, displayLabel: string, type: 'collection' | 'variable' | 'context' | 'pages' | 'theme') => void;
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
function ItemContextGroup({
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
/** LOCAL section — shows FormContainer's local.data.form.* when inside a FormContainer */
function FormLocalSection({
  onInsert,
}: {
  onInsert: (formulaPath: string, displayLabel: string, type: VarRowItem['type']) => void;
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
    const local = (vsData['local'] ?? {}) as Record<string, unknown>;
    const data = (local['data'] ?? {}) as Record<string, unknown>;
    return (data['form'] ?? { formData: {}, fields: {}, isSubmitting: false, isSubmitted: false, isValid: false }) as {
      formData: Record<string, unknown>;
      fields: Record<string, { value: unknown; isValid: boolean }>;
      isSubmitting: boolean;
      isSubmitted: boolean;
      isValid: boolean;
    };
  }, [vsData]);

  const FORM_CC = { bg: '#c2410c', border: '#ea580c', text: '#ffedd5' };

  const handleInsert = (subPath: string, label: string) => {
    // Build optional-chaining formula: local.data?.['form']?.['subPath']
    const segs = subPath.split('.').filter(Boolean);
    let formula = 'local.data';
    for (const seg of segs) formula += `?.['${seg}']`;
    onInsert(formula, `local.data.${subPath}`, 'form');
  };

  const [localDataOpen, setLocalDataOpen] = useState(true);
  const [formOpen, setFormOpen] = useState(true);

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

function ContextDataSection({
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
function PagesDataSection({
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
function ColorsDataSection({
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
function TypographyDataSection({
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
function BorderRadiusDataSection({
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

function CollectionsDataTab({ onInsert, search }: {
  onInsert: (formulaPath: string, displayLabel: string, type: 'collection' | 'variable' | 'context' | 'pages' | 'theme') => void;
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

function FunctionLibrary({ onInsert, onInsertFn, search, globalFormulas }: {
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

function FnRow({ fn, onInsertFn }: { fn: FnDef; onInsertFn: (fnInsert: string, signature: string) => void }) {
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
  const { globalFormulas, pageDataSources, customVars, varFolders } = useBuilderStore();
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

  // Detect if the selected node is inside a FormContainer ancestor
  const isInsideForm = useMemo(() => {
    const id = selectedIds[0];
    if (!id) return false;
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

    return {
      ...zustandData,
      ...vs,
      collections: collectionsMap,
      variables: vs,
      // Wrap contextItem in the same weWeb structure as renderer.tsx so
      // context.item?.['data']?.['slug'] resolves correctly in the preview.
      context: contextItem ? {
        item: {
          ...contextItem,   // backward compat: context.item?.['slug'] still resolves
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
      } : {},
      globalContext,
      pages,
      theme,
    };
  }, [zustandData, selectedIds, pageNodes]);

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
  const insertChip = useCallback((formulaPath: string, displayLabel: string, type: 'collection' | 'variable' | 'context' | 'pages' | 'theme' | 'form') => {
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
