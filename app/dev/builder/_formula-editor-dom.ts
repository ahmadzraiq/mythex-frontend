/**
 * _formula-editor-dom.ts
 *
 * Pure DOM/chip utilities for the formula editor contenteditable area.
 * Extracted from _formula-editor.tsx — no React, no JSX.
 *
 * Exports:
 *  - highlightJson
 *  - buildFormulaPath, buildDisplayLabel, pathToFormulaAndDisplay
 *  - serializeEditor, normalizeEditorContent, serializeRangeFromEditor
 *  - CHIP_RE, CHIP_INNER_CSS, CHIP_STYLE
 *  - buildChipSpan, insertChipAtCaret, insertPlainTextAtCaret
 *  - FUNCTION_LIBRARY, FnDef (type), OPERATORS
 *  - OP_CHIP, OP_STYLE, buildOperatorChip, OP_TOKEN_RE, OP_INSERT_MAP
 *  - AUTO_CHIP_RE, AUTO_CHIP_TYPED_MAP, rechipCurrentTextNode
 *  - KNOWN_FN_NAMES, FN_NAME_RE, FN_NAME_SUFFIX_RE
 *  - buildFunctionChip, countSignatureCommas, insertFunctionChipsAtCaret
 *  - insertOperatorChipAtCaret
 *  - appendTextSegment, appendTextWithOperatorChips
 *  - contextPathToChipFormula, insertPastedFormulaAtCaret, populateEditor
 */

import themeConfig from '@/config/theme.json';

// ─── JSON syntax highlighter ──────────────────────────────────────────────────

export function highlightJson(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    match => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `<span style="color:#93c5fd">${match}</span>`;
        return `<span style="color:#fcd34d">${match}</span>`;
      }
      if (/true|false/.test(match)) return `<span style="color:#86efac">${match}</span>`;
      if (/null/.test(match))       return `<span style="color:#6b7280">${match}</span>`;
      return `<span style="color:#67e8f9">${match}</span>`;
    },
  );
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

export function buildFormulaPath(uuid: string, segments: Array<string | number>): string {
  let path = `collections['${uuid}']`;
  for (const seg of segments) {
    path += typeof seg === 'number' ? `?.[${seg}]` : `?.['${seg}']`;
  }
  return path;
}

export function buildDisplayLabel(collectionLabel: string, segments: Array<string | number>): string {
  let label = collectionLabel;
  for (const seg of segments) {
    label += typeof seg === 'number' ? `[${seg}]` : `.${seg}`;
  }
  return label;
}

export function pathToFormulaAndDisplay(
  nodePath: string,
  storeKey: string,
  displayName: string,
): { formulaPath: string; displayLabel: string } {
  const rest = nodePath.slice(storeKey.length);
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

// ─── Editor serialization ─────────────────────────────────────────────────────

export function serializeEditor(el: HTMLElement): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/\u200b/g, '');
    } else if (node instanceof HTMLElement && node.dataset.formula) {
      out += node.dataset.formula;
    }
  }
  return out;
}

export function normalizeEditorContent(editorEl: HTMLElement): void {
  let child = editorEl.firstChild;
  while (child) {
    const next = child.nextSibling;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName === 'BR') {
        editorEl.removeChild(el);
      } else if ((el.tagName === 'DIV' || el.tagName === 'P') && !el.dataset.type && !el.dataset.formula) {
        while (el.firstChild) editorEl.insertBefore(el.firstChild, el);
        editorEl.removeChild(el);
      }
    }
    child = next;
  }
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

export function serializeRangeFromEditor(editorEl: HTMLElement, sel: Selection): string {
  if (!sel.rangeCount) return '';
  const range = sel.getRangeAt(0);
  let out = '';
  for (const node of editorEl.childNodes) {
    if (!range.intersectsNode(node)) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = (node.textContent ?? '').replace(/\u200b/g, '');
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

// ─── Chip constants ───────────────────────────────────────────────────────────

/**
 * CHIP_RE matches:
 *   collections['UUID'](?.['key'] | ?.[N])*
 *   variables['UUID'](?.['key'] | ?.[N])*
 *   context.workflow['stepId'](?.field | .field)*  — workflow step results
 *   context.item(?.['key'] | dot.notation)*  |  context.index  |  context.parent
 *   globalContext.browser(?.['key'])*  |  globalContext.screen(?.['key'])*
 *   pages['UUID'](?.['key'])*
 *   theme.(colors|sections|fonts)(?.['key'])*
 *   local.data(?.['key'])*   — weWeb-style FormContainer local state
 *   event(?.['key'])*        — workflow trigger event context
 */
export const CHIP_RE = /collections\['([^']+)'\](?:\?\.\['[^']*'\]|\?\.\[\d+\]|\.[\w$]+)*|variables\['([^']+)'\](?:\?\.\['[^']*'\]|\?\.\[\d+\]|\.[\w$]+)*|local\.data(?:\?\.\['[^']*'\]|\?\.\[\d+\]|\.[\w$]+)*|context\.workflow\['[^']+'\](?:(?:\?)?\.[\w$]+|\?\.\['[^']*'\]|\?\.\[\d+\])*|context\.(?:item|index|parent)(?:(?:\?\.\['[^']*'\]|\?\.\[\d+\])|(?:\.\w+))*|globalContext\.(?:browser|screen)(?:\?\.\['[^']*'\])*|pages\['[^']+'\](?:\?\.\['[^']*'\])*|theme(?:\.(?:colors|sections|fonts|radius)|\?\.\['(?:colors|sections|fonts|radius)'\])(?:\?\.\['[^']*'\]|\.\w+)*|components\?\.\['([^']+)'\](?:\?\.\['[^']*'\]|\?\.\[\d+\])*|event(?:\?\.\['[^']*'\]|\?\.\[\d+\])*/g;

export const CHIP_INNER_CSS = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;display:block';

export const CHIP_STYLE: Record<string, string> = {
  collection: 'background:#1d4ed8;color:#bfdbfe;border:1px solid #2563eb',
  variable:   'background:#0f766e;color:#ccfbf1;border:1px solid #0d9488',
  context:    'background:#7c3aed;color:#e9d5ff;border:1px solid #8b5cf6',
  pages:      'background:#0e7490;color:#cffafe;border:1px solid #0891b2',
  theme:      'background:#b45309;color:#fef3c7;border:1px solid #d97706',
  form:       'background:#c2410c;color:#ffedd5;border:1px solid #ea580c',
  error:      'background:#991b1b;color:#fecaca;border:1px solid #b91c1c',
  event:      'background:#92400e;color:#fed7aa;border:1px solid #fb923c',
};

// ─── Chip builders ────────────────────────────────────────────────────────────

export function buildChipSpan(
  formulaPath: string,
  displayLabel: string,
  type: 'collection' | 'variable' | 'context' | 'pages' | 'theme' | 'form' | 'error' | 'event',
): HTMLSpanElement {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.dataset.type = type;
  span.dataset.formula = formulaPath;
  const colors = CHIP_STYLE[type] ?? CHIP_STYLE.variable;
  span.style.cssText =
    colors + ';border-radius:5px;padding:2px 4px;display:inline-flex;align-items:center;gap:3px;font-size:11px;line-height:1.4;cursor:default;vertical-align:middle;margin:0 1px;font-family:monospace;font-weight:600';

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

export function insertChipAtCaret(
  editorEl: HTMLElement,
  formulaPath: string,
  displayLabel: string,
  type: 'collection' | 'variable' | 'context' | 'pages' | 'theme' | 'form' | 'error' | 'event',
): void {
  editorEl.focus();
  const sel = window.getSelection();
  if (!sel?.rangeCount) {
    const span = buildChipSpan(formulaPath, displayLabel, type);
    editorEl.appendChild(span);
    const r = document.createRange();
    r.setStartAfter(span); r.collapse(true);
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
  const span = buildChipSpan(formulaPath, displayLabel, type);
  sel.getRangeAt(0).insertNode(span);
  const r = document.createRange();
  r.setStartAfter(span); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}

export function insertPlainTextAtCaret(editorEl: HTMLElement, text: string): void {
  editorEl.focus();
  const sel = window.getSelection();
  if (!sel?.rangeCount) {
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

// ─── Function Library ─────────────────────────────────────────────────────────

export interface FnDef {
  name: string;
  signature: string;
  description: string;
  returnType: string;
  insert: string;
}

export const FUNCTION_LIBRARY: Record<string, FnDef[]> = {
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

export const OPERATORS: Array<{ label: string; insert: string; description: string; category: 'comparison' | 'logical' | 'math' | 'punct' }> = [
  { label: '=',   insert: ' === ', description: 'Equal to (strict)',          category: 'comparison' },
  { label: '!=',  insert: ' !== ', description: 'Not equal to (strict)',      category: 'comparison' },
  { label: '>=',  insert: ' >= ',  description: 'Greater than or equal to',   category: 'comparison' },
  { label: '<=',  insert: ' <= ',  description: 'Less than or equal to',      category: 'comparison' },
  { label: '>',   insert: ' > ',   description: 'Greater than',               category: 'comparison' },
  { label: '<',   insert: ' < ',   description: 'Less than',                  category: 'comparison' },
  { label: 'and', insert: ' && ',  description: 'Logical AND — true only if both sides are true', category: 'logical' },
  { label: 'or',  insert: ' || ',  description: 'Logical OR — true if at least one side is true', category: 'logical' },
  { label: '+',   insert: ' + ',   description: 'Addition or string concatenation', category: 'math' },
  { label: '-',   insert: ' - ',   description: 'Subtraction',                category: 'math' },
  { label: '*',   insert: ' * ',   description: 'Multiplication',             category: 'math' },
  { label: '/',   insert: ' / ',   description: 'Division',                   category: 'math' },
  { label: 'mod', insert: ' % ',   description: 'Modulo — remainder of division', category: 'math' },
  { label: '(',   insert: '(',     description: 'Open parenthesis',           category: 'punct' },
  { label: ')',   insert: ')',     description: 'Close parenthesis',          category: 'punct' },
  { label: ',',   insert: ', ',    description: 'Argument separator',         category: 'punct' },
];

// ─── Operator chip helpers ────────────────────────────────────────────────────

export const OP_CHIP = { bg: '#1e293b', border: '#334155', color: '#94a3b8', hoverBg: '#334155' };

export const OP_STYLE: Record<string, { bg: string; border: string; color: string; hoverBg: string }> = {
  comparison: OP_CHIP,
  logical:    OP_CHIP,
  math:       OP_CHIP,
  punct:      OP_CHIP,
};

export function buildOperatorChip(label: string, insertValue: string, category: string): HTMLSpanElement {
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

export const OP_TOKEN_RE = new RegExp(
  OPERATORS
    .map(op => op.insert.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|'),
  'g',
);

export const OP_INSERT_MAP = new Map(OPERATORS.map(op => [op.insert, op]));

export const AUTO_CHIP_RE = /===|!==|>=|<=|&&|\|\||\(|\)|,|\+|\*|\/|%|-|>|</g;

export const AUTO_CHIP_TYPED_MAP: Record<string, { label: string; insert: string; category: string }> = {
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

// ─── Function chip helpers ────────────────────────────────────────────────────

export function buildFunctionChip(fnName: string): HTMLSpanElement {
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

export function countSignatureCommas(signature: string): number {
  const m = signature.match(/\(([^)]*)\)/);
  if (!m || !m[1].trim()) return 0;
  const inner = m[1].trim();
  if (!inner) return 0;
  if (inner.includes('...')) return Math.max(1, inner.split(',').length - 1);
  return Math.max(0, inner.split(',').length - 1);
}

export function insertFunctionChipsAtCaret(editorEl: HTMLElement, fnInsert: string, signature: string): void {
  const fnName = fnInsert.endsWith('(') ? fnInsert.slice(0, -1) : fnInsert;
  const nCommas = countSignatureCommas(signature);

  editorEl.focus();
  const sel = window.getSelection();

  if (!sel?.rangeCount || !editorEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const r = document.createRange();
    r.selectNodeContents(editorEl); r.collapse(false);
    sel?.removeAllRanges(); sel?.addRange(r);
  }
  sel!.getRangeAt(0).deleteContents();

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
  const r = document.createRange();
  r.setStartAfter(openChip); r.collapse(true);
  sel!.removeAllRanges(); sel!.addRange(r);
}

export function insertOperatorChipAtCaret(editorEl: HTMLElement, label: string, insertValue: string, category: string): void {
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

// ─── Function name matching ───────────────────────────────────────────────────

export const KNOWN_FN_NAMES = new Set(
  Object.values(FUNCTION_LIBRARY).flatMap(fns => fns.map(f => f.name))
);

export const FN_NAME_RE = new RegExp(
  '(?<![a-zA-Z_$])(' + [...KNOWN_FN_NAMES].sort((a, b) => b.length - a.length).join('|') + ')(?![a-zA-Z_$0-9])',
  'g',
);

export const FN_NAME_SUFFIX_RE = new RegExp(
  '(?<![a-zA-Z_$])(' + [...KNOWN_FN_NAMES].sort((a, b) => b.length - a.length).join('|') + ')$',
);

// ─── Text segment helpers ─────────────────────────────────────────────────────

export function appendTextSegment(el: HTMLElement, text: string): void {
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

export function appendTextWithOperatorChips(el: HTMLElement, text: string): void {
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

// ─── rechipCurrentTextNode ────────────────────────────────────────────────────

export function rechipCurrentTextNode(editorEl: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const container = range.startContainer;
  if (container.nodeType !== Node.TEXT_NODE || container.parentNode !== editorEl) return false;

  const text = container.textContent ?? '';
  AUTO_CHIP_RE.lastIndex = 0;
  if (!AUTO_CHIP_RE.test(text)) return false;
  AUTO_CHIP_RE.lastIndex = 0;

  const cursorOffset = range.startOffset;
  type Seg = { node: Node; srcLen: number };
  const segments: Seg[] = [];
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = AUTO_CHIP_RE.exec(text)) !== null) {
    const beforeText = text.slice(lastEnd, m.index);
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
        newCursorNode = seg.node;
        useAfter = true;
      }
    }
    consumed = segEnd;
  }

  const parent = container.parentNode!;
  const nextSibling = container.nextSibling;
  parent.removeChild(container);
  for (const seg of segments) {
    if (nextSibling) parent.insertBefore(seg.node, nextSibling);
    else parent.appendChild(seg.node);
  }

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

// ─── context path helper ──────────────────────────────────────────────────────

export function contextPathToChipFormula(path: string): string {
  let scopeRoot: string;
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
    const rest = path.slice(8).split('.');
    scopeRoot = rest[0];
    fieldParts = rest.slice(1);
  } else {
    scopeRoot = 'item';
    fieldParts = path.split('.').filter(Boolean);
  }

  const suffix = fieldParts.map(s => `?.['${s}']`).join('');
  return `context.${scopeRoot}${suffix}`;
}

// ─── populateEditor ───────────────────────────────────────────────────────────

export function populateEditor(
  el: HTMLElement,
  formula: string,
  dsMap: Map<string, { label: string }>,
  varMap?: Map<string, { label: string }>,
): void {
  el.innerHTML = '';
  if (!formula) return;

  const processed = formula;

  CHIP_RE.lastIndex = 0;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = CHIP_RE.exec(processed)) !== null) {
    if (match.index > lastEnd) {
      appendTextWithOperatorChips(el, processed.slice(lastEnd, match.index));
    }
    let formulaPath = match[0];
    const collectionUUID = match[1];
    const variableUUID = match[2];
    const legacyComponentId = match[3]; // backward compat: components?.['id']?.['value']

    if (legacyComponentId) {
      // Old formula format written before WeWeb-style migration.
      // Redirect to the new variables['{id}'] chip to avoid plain-text rendering.
      const newFormula = `variables['${legacyComponentId}']`;
      const displayLabel = varMap?.get(legacyComponentId)?.label ?? legacyComponentId;
      el.appendChild(buildChipSpan(newFormula, displayLabel, 'variable'));
    } else if (collectionUUID) {
      const base = dsMap.get(collectionUUID)?.label ?? collectionUUID;
      const afterRoot = formulaPath.slice(`collections['${collectionUUID}']`.length);
      const segs: Array<string | number> = [];
      let rem = afterRoot;
      while (rem.length > 0) {
        const numM = rem.match(/^\?\.\[(\d+)\](.*)/);
        if (numM) { segs.push(Number(numM[1])); rem = numM[2]; continue; }
        const strM = rem.match(/^\?\.\['([^']+)'\](.*)/);
        if (strM) { segs.push(strM[1]); rem = strM[2]; continue; }
        // dot-notation sub-path: .fieldName or .field.sub.path
        const dotM = rem.match(/^\.([^.[]+)(.*)/);
        if (dotM) { segs.push(dotM[1]); rem = dotM[2]; continue; }
        break;
      }
      el.appendChild(buildChipSpan(formulaPath, buildDisplayLabel(base, segs), 'collection'));
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
        // dot-notation sub-path: .fieldName or .field.sub.path
        const dotM = rem.match(/^\.([^.[]+)(.*)/);
        if (dotM) { segs.push(dotM[1]); rem = dotM[2]; continue; }
        break;
      }
      el.appendChild(buildChipSpan(formulaPath, buildDisplayLabel(base, segs), 'variable'));
    } else if (formulaPath.startsWith('local.data')) {
      const after = formulaPath.slice('local.data'.length);
      let normalized: string;
      if (!after || after.startsWith("?.['")) {
        normalized = formulaPath;
      } else {
        normalized = 'local.data';
        for (const seg of after.slice(1).split('.')) {
          if (seg) normalized += `?.['${seg}']`;
        }
      }
      const friendly = normalized
        .replace(/\?\.\['([^']+)'\]/g, '.$1')
        .replace(/\?\.\[(\d+)\]/g, '[$1]');
      el.appendChild(buildChipSpan(normalized, friendly, 'form'));
    } else if (formulaPath.startsWith('context.workflow[')) {
      // Workflow step result/error path — "stepId.result.field" (blue) or "stepId.error.field" (red)
      const stepIdMatch = formulaPath.match(/^context\.workflow\['([^']*)'\]/);
      const stepId = stepIdMatch?.[1] ?? 'Action';
      const afterStepId = formulaPath.slice((stepIdMatch?.[0] ?? '').length);
      const friendly = (stepId + afterStepId)
        .replace(/\?\./g, '.')
        .replace(/\.\[(\d+)\]/g, '[$1]');
      const isErrorPath = afterStepId.startsWith('.error');
      el.appendChild(buildChipSpan(formulaPath, friendly, isErrorPath ? 'error' : 'collection'));
    } else if (formulaPath.startsWith('context.')) {
      if (!formulaPath.includes("?.['")) {
        formulaPath = contextPathToChipFormula(formulaPath);
      }
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
      const categoryMatch = formulaPath.match(/theme\??\.?\[?'?(colors|sections|fonts|radius)'\]?\??/);
      const category = categoryMatch?.[1] ?? '';
      const prefix = category === 'colors' ? 'Color' : category === 'fonts' ? 'Typography' : category === 'radius' ? 'Radius' : category === 'sections' ? 'Section' : '';
      const lastKeyMatch = formulaPath.match(/\?\.\['([^']+)'\]\s*$/) ?? formulaPath.match(/\.(\w+)\s*$/);
      const leaf = lastKeyMatch?.[1] ?? formulaPath;
      const friendly = prefix ? `${prefix} - ${leaf}` : leaf;
      el.appendChild(buildChipSpan(formulaPath, friendly, 'theme'));
    } else if (formulaPath.startsWith('event')) {
      // Workflow trigger event: event, event?.['value'], event?.['x'], etc.
      const friendly = formulaPath
        .replace(/\?\.\['([^']+)'\]/g, '.$1')
        .replace(/\?\.\[(\d+)\]/g, '[$1]');
      el.appendChild(buildChipSpan(formulaPath, friendly, 'event'));
    }
    lastEnd = match.index + formulaPath.length;
  }

  if (lastEnd < processed.length) {
    appendTextWithOperatorChips(el, processed.slice(lastEnd));
  }

  normalizeEditorContent(el);
}

// ─── insertPastedFormulaAtCaret ───────────────────────────────────────────────

export function insertPastedFormulaAtCaret(
  editorEl: HTMLElement,
  text: string,
  dsMap: Map<string, { label: string }>,
  varMap?: Map<string, { label: string }>,
): void {
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
