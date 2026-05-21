/**
 * misc.ts — Emitters for action types that don't fit a single-concern file.
 *
 * Covers:
 *   navigateTo         (alias for navigate)
 *   changeVariableValue (alias for setVar / set)
 *   fetchCollection    (alias for refetchDataSource)
 *   runJavaScript      (custom JS — wrapped in async IIFE)
 *   branch             (if/else control flow)
 *   forEach            (loop over a list)
 *   runProjectWorkflow (call a named/id workflow)
 *   timeDelay          (await setTimeout)
 *   scrollToElement    (DOM scrollIntoView)
 *   animate / startLoop / stopLoop / playEnterAnimation / triggerExitAnimation
 *   executeComponentAction (delegate to a workflow)
 */

import type { SymbolMap } from '../types';
import { rewritePropValue, rewriteFormula, pathToExpr } from '../formula-rewrite';
import { toIdent } from '../identifiers';
import { emitStep } from './index';

// ── navigateTo ────────────────────────────────────────────────────────────────

interface NavigateToStep {
  type: 'navigateTo';
  config?: {
    path?: string;
    url?: string;
    linkType?: string;
    newTab?: boolean;
    queryParams?: Record<string, unknown>;
  };
}

export function emitNavigateTo(step: NavigateToStep, symbols: SymbolMap): string {
  const cfg = step.config ?? {};
  const path = cfg.path ?? cfg.url ?? '';

  const pathStr = String(path ?? '');
  const pathExpr = pathStr.includes('{{') ? rewritePropValue(pathStr, symbols) : JSON.stringify(pathStr);

  if (cfg.queryParams && Object.keys(cfg.queryParams).length > 0) {
    // Build an object literal where each value is run through rewritePropValue so that
    // formula values (e.g. { formula: "context?.item?.data?.slug" }) and template strings
    // (e.g. "{{state.variables.id}}") are both correctly resolved at runtime.
    const entries = Object.entries(cfg.queryParams)
      .map(([k, v]) => `${JSON.stringify(k)}: ${rewritePropValue(v, symbols)}`)
      .join(', ');
    const queryObj = `{ ${entries} }`;
    if (cfg.newTab) return `window.open(${pathExpr} + buildQueryString(${queryObj}), '_blank');`;
    return `router.push(${pathExpr} + buildQueryString(${queryObj}));`;
  }

  if (cfg.newTab) return `window.open(${pathExpr}, '_blank');`;
  return `router.push(${pathExpr});`;
}

// ── changeVariableValue ───────────────────────────────────────────────────────

interface ChangeVarStep {
  type: 'changeVariableValue';
  config?: { variableName?: string; value?: unknown };
}

export function emitChangeVariableValue(step: ChangeVarStep, symbols: SymbolMap): string {
  const cfg = step.config ?? {};
  const nameOrUuid = cfg.variableName ?? '';
  const rawValue = cfg.value;
  // Declared variables are stored with their camelCase identifier key (consistent with JSX dot-notation reads).
  // Undeclared variables (not in symbols.vars) are stored with the original name as a quoted key
  // because JSX reads them via bracket notation: state.variables['original-name'].
  const ident = symbols.vars.get(nameOrUuid);
  if (!ident && !nameOrUuid) {
    return `/* changeVariableValue: skipped — no variableName configured */`;
  }
  // Use rewritePropValue — it already handles formula/js with IIFE wrapping for multi-statement code
  const finalValue = rewritePropValue(rawValue, symbols);
  const keyExpr = ident ?? JSON.stringify(nameOrUuid); // camelCase for declared, quoted original for undeclared
  return `useStore.setState(s => ({ ...s, variables: { ...s.variables, ${keyExpr}: ${finalValue} } }));`;
}

// ── fetchCollection ───────────────────────────────────────────────────────────

interface FetchCollectionStep {
  type: 'fetchCollection';
  config?: { collectionId?: string };
}

export function emitFetchCollection(step: FetchCollectionStep, symbols: SymbolMap): string {
  const id = step.config?.collectionId ?? '';
  const dsIdent = symbols.collections.get(id);
  if (dsIdent) {
    return `{\n  const result = await api.${dsIdent}();\n  useStore.setState(s => ({ ...s, collections: { ...s.collections, ${dsIdent}: result } }));\n}`;
  }
  return `/* fetchCollection: unknown collection ${id} */`;
}

// ── runJavaScript ─────────────────────────────────────────────────────────────

interface RunJSStep {
  type: 'runJavaScript';
  config?: { code?: string };
}

export function emitRunJavaScript(step: RunJSStep, symbols: SymbolMap): string {
  const code = step.config?.code ?? '';
  if (!code.trim()) return '/* runJavaScript: empty */';

  // Rewrite formula patterns in the code
  const rewritten = rewriteFormula(code, symbols);

  // Emit as an async IIFE so `return` inside the code works as expected
  const lines = rewritten.split('\n').map(l => `  ${l}`).join('\n');
  return `await (async () => {\n${lines}\n})();`;
}

// ── branch (if/else) ──────────────────────────────────────────────────────────

interface BranchStep {
  type: 'branch';
  config?: { condition?: unknown };
  trueBranch?: Record<string, unknown>[];
  falseBranch?: Record<string, unknown>[];
}

/**
 * Resolve any binding value (string, { formula }, { js }, { var }) to a valid
 * JavaScript expression that can be placed inline in JSX or a condition.
 *
 * - Single `return <expr>;` → strips `return` so `if (expr)` stays valid
 * - Multi-statement JS    → wraps in IIFE `(() => { ... })()`
 * - `||` before `??`      → adds parens to satisfy operator precedence
 */
export function resolveExpr(value: unknown, symbols: SymbolMap, fallback = 'undefined', inMapScope = false): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return rewriteFormula(value, symbols, inMapScope);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.formula === 'string') return rewriteFormula(obj.formula, symbols, inMapScope);
    if (typeof obj.var === 'string') return pathToExpr(obj.var, symbols, inMapScope);
    if (typeof obj.js === 'string') {
      const rewritten = rewriteFormula(obj.js, symbols, inMapScope);
      // Single `return <expr>;` → extract just the expression
      const singleReturn = rewritten.match(/^\s*return\s+([\s\S]+?);\s*$/);
      if (singleReturn) {
        const expr = singleReturn[1]!.trim();
        return fixNullishPrecedence(expr);
      }
      // Multi-statement → wrap in IIFE so it can be used as an expression
      if (/\b(const|let|var|return)\b/.test(rewritten)) {
        return `(() => { ${rewritten} })()`;
      }
      return fixNullishPrecedence(rewritten);
    }
  }
  return fallback;
}

/** For condition checks, use 'true' as default fallback */
function resolveConditionExpr(cond: unknown, symbols: SymbolMap): string {
  return resolveExpr(cond, symbols, 'true');
}

/**
 * Fix `expr || default ?? fallback` → `(expr || default) ?? fallback`.
 * Mixing `||`/`&&` with `??` at the same precedence level is a syntax error in JS.
 */
function fixNullishPrecedence(expr: string): string {
  // If expr contains `||` or `&&` directly followed by `??` (no parens covering the left side),
  // we need to wrap the left-hand side of `??` in parens.
  if (/\?\?/.test(expr) && /\|\||&&/.test(expr)) {
    // Only fix if `??` appears after a `|| ...` or `&& ...` without surrounding parens
    // Simple heuristic: wrap the entire expression in parens if it mixes the operators
    // without obvious grouping. Check if top-level `??` exists alongside `||`/`&&`.
    // We use a depth-counter to find top-level operators.
    if (hasTopLevelMixedNullish(expr)) {
      return `(${expr.replace(/\s*\?\?\s*\[\]$/, '')}) ?? []`;
    }
  }
  return expr;
}

function hasTopLevelMixedNullish(expr: string): boolean {
  let depth = 0;
  let hasNullish = false;
  let hasLogical = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0) {
      if (expr.slice(i, i + 2) === '??') hasNullish = true;
      if (expr.slice(i, i + 2) === '||' || expr.slice(i, i + 2) === '&&') hasLogical = true;
    }
  }
  return hasNullish && hasLogical;
}

export function emitBranch(step: BranchStep, symbols: SymbolMap): string {
  const condExpr = resolveConditionExpr(step.config?.condition, symbols);

  const trueLines = (step.trueBranch ?? []).map(s => `  ${emitStep(s, symbols)}`).join('\n');
  const falseLines = (step.falseBranch ?? []).map(s => `  ${emitStep(s, symbols)}`).join('\n');

  if (falseLines.trim()) {
    return `if (${condExpr}) {\n${trueLines}\n} else {\n${falseLines}\n}`;
  }
  return `if (${condExpr}) {\n${trueLines}\n}`;
}

// ── forEach ───────────────────────────────────────────────────────────────────

interface ForEachStep {
  type: 'forEach';
  config?: { items?: unknown };
  loopBody?: Record<string, unknown>[];
  steps?: Record<string, unknown>[];
}

export function emitForEach(step: ForEachStep, symbols: SymbolMap): string {
  const listExpr = resolveExpr(step.config?.items, symbols, '[]');
  const safeExpr = /\|\||&&/.test(listExpr) ? `(${listExpr})` : listExpr;
  const bodySteps = step.loopBody ?? step.steps ?? [];
  const bodyLines = bodySteps.map(s => `  ${emitStep(s, symbols)}`).join('\n');
  return `for (const _item of (${safeExpr} ?? [])) {\n${bodyLines}\n}`;
}

// ── runProjectWorkflow ────────────────────────────────────────────────────────

interface RunProjectWorkflowStep {
  type: 'runProjectWorkflow';
  config?: { workflowId?: string };
}

export function emitRunProjectWorkflow(step: RunProjectWorkflowStep, symbols: SymbolMap): string {
  const id = step.config?.workflowId ?? '';
  const wfName = symbols.workflows.get(id) ?? toIdent(id);
  return `await ${wfName}(ctx);`;
}

// ── timeDelay ─────────────────────────────────────────────────────────────────

interface TimeDelayStep {
  type: 'timeDelay';
  config?: { duration?: number; time?: number };
}

export function emitTimeDelay(step: TimeDelayStep): string {
  const ms = step.config?.duration ?? step.config?.time ?? 0;
  return `await new Promise<void>(resolve => setTimeout(resolve, ${ms}));`;
}

// ── scrollToElement ───────────────────────────────────────────────────────────

interface ScrollStep {
  type: 'scrollToElement';
  config?: { elementId?: string; targetNodeId?: string; behavior?: string; block?: string };
}

export function emitScrollToElement(step: ScrollStep): string {
  const id = step.config?.elementId ?? step.config?.targetNodeId ?? '';
  const behavior = step.config?.behavior ?? 'smooth';
  const block = step.config?.block ?? 'start';
  return `document.getElementById(${JSON.stringify(id)})?.scrollIntoView({ behavior: '${behavior}', block: '${block}' });`;
}

// ── animate / triggerExitAnimation / startLoop / stopLoop / playEnterAnimation ─

interface AnimateStep {
  type: 'animate' | 'triggerExitAnimation' | 'startLoop' | 'stopLoop' | 'playEnterAnimation';
  config?: { targetNodeId?: string; animation?: string; enterType?: string; loopType?: string; duration?: number };
}

export function emitAnimateStep(step: AnimateStep): string {
  const id = step.config?.targetNodeId ?? '';
  const animType = step.config?.animation ?? step.config?.enterType ?? step.config?.loopType ?? '';
  const dur = step.config?.duration ?? 300;

  // Framer Motion imperative animation — requires a ref on the target element.
  // Emit a CSS class toggle as a reliable fallback that works without ref access.
  switch (step.type) {
    case 'animate':
    case 'playEnterAnimation':
      return [
        `{`,
        `  const _el = document.getElementById(${JSON.stringify(id)});`,
        `  if (_el) {`,
        `    _el.style.animation = 'none';`,
        `    _el.offsetHeight; // reflow`,
        `    _el.style.animation = '${animType} ${dur}ms ease-in-out';`,
        `  }`,
        `}`,
      ].join('\n');
    case 'triggerExitAnimation':
      // Apply exit animation with `forwards` fill so element stays in final state until hidden
      return [
        `{`,
        `  const _el = document.getElementById(${JSON.stringify(id)});`,
        `  if (_el) {`,
        `    _el.style.animation = 'none';`,
        `    _el.offsetHeight; // reflow`,
        `    _el.style.animation = '${animType} ${dur}ms ease-in-out forwards';`,
        `  }`,
        `}`,
      ].join('\n');
    case 'startLoop':
      return [
        `{`,
        `  const _el = document.getElementById(${JSON.stringify(id)});`,
        `  if (_el) _el.style.animation = '${animType} ${dur}ms ease-in-out infinite';`,
        `}`,
      ].join('\n');
    case 'stopLoop':
      return [
        `{`,
        `  const _el = document.getElementById(${JSON.stringify(id)});`,
        `  if (_el) _el.style.animation = 'none';`,
        `}`,
      ].join('\n');
    default:
      return `/* ${step.type}: ${id} */`;
  }
}

// ── executeComponentAction ────────────────────────────────────────────────────

interface ExecComponentAction {
  type: 'executeComponentAction';
  config?: { action?: string; args?: Record<string, unknown> };
}

export function emitExecuteComponentAction(step: ExecComponentAction, symbols: SymbolMap): string {
  const action = step.config?.action ?? '';
  if (!action) return '/* executeComponentAction: no action specified */';
  const wfName = symbols.workflows.get(action) ?? toIdent(action);
  return `await ${wfName}(ctx);`;
}

// ── navigatePrev ──────────────────────────────────────────────────────────────

export function emitNavigatePrev(step: Record<string, unknown>): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  if (cfg.defaultRedirect) {
    return `if (typeof window !== 'undefined' && window.history.length > 1) { router.back(); } else { router.push(${JSON.stringify(cfg.defaultRedirect)}); }`;
  }
  return `router.back();`;
}

// ── returnValue ───────────────────────────────────────────────────────────────

export function emitReturnValue(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const val = cfg.value;
  if (val == null) return `return;`;
  const expr = rewritePropValue(val, symbols);
  return `return ${expr};`;
}

// ── breakLoop / continueLoop ─────────────────────────────────────────────────

export function emitBreakLoop(): string { return `break;`; }
export function emitContinueLoop(): string { return `continue;`; }

// ── whileLoop ─────────────────────────────────────────────────────────────────

export function emitWhileLoop(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const condPath = cfg.conditionPath as string | undefined;
  const condRaw = cfg.condition;
  let condExpr = 'true';
  if (condPath) condExpr = pathToExpr(condPath, symbols);
  else if (condRaw) condExpr = resolveConditionExpr(condRaw, symbols);

  const body = (step.loopBody ?? step.steps ?? []) as Record<string, unknown>[];
  const bodyLines = body.map(s => `  ${emitStep(s, symbols)}`).join('\n');
  return `while (${condExpr}) {\n${bodyLines}\n}`;
}

// ── multiOptionBranch (switch) ────────────────────────────────────────────────

export function emitMultiOptionBranch(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const condRaw = cfg.condition;
  const condExpr = condRaw ? resolveConditionExpr(condRaw, symbols) : 'undefined';
  const branches = (step.branches ?? []) as Array<{ label?: string; value?: unknown; steps?: Record<string, unknown>[] }>;

  const cases = branches.map(b => {
    const label = b.label != null ? b.label : b.value;
    const branchSteps = (b.steps ?? []).map(s => `    ${emitStep(s, symbols)}`).join('\n');
    return `  case ${JSON.stringify(label)}:\n${branchSteps}\n    break;`;
  }).join('\n');

  return `switch (${condExpr}) {\n${cases}\n}`;
}

// ── passThroughCondition ──────────────────────────────────────────────────────

export function emitPassThrough(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const cond = cfg.condition;
  if (!cond) return `/* passThroughCondition: no condition */`;
  const condExpr = resolveConditionExpr(cond, symbols);
  return `if (!(${condExpr})) return;`;
}

// ── resetVariableValue ────────────────────────────────────────────────────────

export function emitResetVariableValue(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const nameOrUuid = cfg.variableName as string ?? '';
  if (!nameOrUuid) return `/* resetVariableValue: skipped — no variableName configured */`;
  const ident = symbols.vars.get(nameOrUuid);
  const keyExpr = ident ?? JSON.stringify(nameOrUuid);
  const def = cfg.defaultValue;
  const defaultExpr = def !== undefined ? rewritePropValue(def, symbols) : 'undefined';
  return `useStore.setState(s => ({ ...s, variables: { ...s.variables, ${keyExpr}: ${defaultExpr} } }));`;
}

// ── fetchData ────────────────────────────────────────────────────────────────

export function emitFetchData(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const url = rewritePropValue(cfg.url, symbols);
  const method = (cfg.method as string | undefined) ?? 'GET';
  const storeIn = cfg.storeIn as string | undefined ?? cfg.storeFullResponseIn as string | undefined;
  const storeIdent = storeIn ? (symbols.vars.get(storeIn) ?? toIdent(storeIn)) : null;

  const lines = [
    `{`,
    `  const _res = await fetch(${url}, { method: '${method}' });`,
    `  const _json = _res.ok ? await _res.json() : { error: _res.status };`,
  ];
  if (storeIdent) {
    lines.push(`  useStore.setState(s => ({ ...s, variables: { ...s.variables, ${storeIdent}: _json } }));`);
  }
  lines.push(`}`);
  return lines.join('\n');
}

// ── fetchCollectionsParallel ─────────────────────────────────────────────────

export function emitFetchCollectionsParallel(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const ids = ((cfg.collectionIds ?? cfg.collectionNames ?? []) as string[]);
  if (ids.length === 0) return `/* fetchCollectionsParallel: no collections */`;

  const calls = ids.map(id => {
    const ident = symbols.collections.get(id) ?? toIdent(id);
    return `api.${ident}().then(r => ({ key: '${ident}', data: r }))`;
  });
  return [
    `{`,
    `  const _results = await Promise.all([${calls.join(', ')}]);`,
    `  useStore.setState(s => ({ ...s, collections: { ...s.collections, ...(Object.fromEntries(_results.map(r => [r.key, r.data]))) } }));`,
    `}`,
  ].join('\n');
}

// ── updateCollection ─────────────────────────────────────────────────────────

export function emitUpdateCollection(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const nameOrUuid = (cfg.name ?? cfg.collectionId ?? '') as string;
  const ident = symbols.collections.get(nameOrUuid) ?? toIdent(nameOrUuid);
  return [
    `{`,
    `  const _result = await api.${ident}();`,
    `  useStore.setState(s => ({ ...s, collections: { ...s.collections, ${ident}: _result } }));`,
    `}`,
  ].join('\n');
}

// ── authenticate / restoreSession / setUser ──────────────────────────────────

export function emitAuthenticate(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const tokenExpr = cfg.accessToken != null ? rewritePropValue(cfg.accessToken, symbols) : `''`;
  const persist = cfg.persist !== false;
  const lines = [
    `{`,
    `  const _token = ${tokenExpr};`,
    `  if (_token) {`,
  ];
  if (persist) {
    lines.push(`    if (typeof window !== 'undefined') localStorage.setItem('auth_token', String(_token));`);
  }
  lines.push(`    useStore.setState(s => ({ ...s, auth: { ...s.auth, token: _token } }));`);
  lines.push(`  }`);
  lines.push(`}`);
  return lines.join('\n');
}

export function emitRestoreSession(): string {
  return [
    `{`,
    `  const _token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;`,
    `  if (_token) useStore.setState(s => ({ ...s, auth: { ...s.auth, token: _token } }));`,
    `}`,
  ].join('\n');
}

export function emitSetUser(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const userExpr = rewritePropValue(cfg.user, symbols);
  return `useStore.setState(s => ({ ...s, auth: { ...s.auth, user: ${userExpr} } }));`;
}

// ── stopPropagation ───────────────────────────────────────────────────────────

export function emitStopPropagation(): string {
  return `if (event && typeof (event as Event).stopPropagation === 'function') (event as Event).stopPropagation();`;
}

// ── copyToClipboard ───────────────────────────────────────────────────────────

export function emitCopyToClipboard(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const val = rewritePropValue(cfg.value ?? cfg.text, symbols);
  return `await navigator.clipboard.writeText(String(${val} ?? ''));`;
}

// ── downloadFileFromUrl ───────────────────────────────────────────────────────

export function emitDownloadFile(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const url = rewritePropValue(cfg.url, symbols);
  const name = rewritePropValue(cfg.fileName ?? cfg.filename ?? 'download', symbols);
  return [
    `{`,
    `  const _a = document.createElement('a');`,
    `  _a.href = String(${url});`,
    `  _a.download = String(${name});`,
    `  _a.click();`,
    `}`,
  ].join('\n');
}

// ── printPdf ─────────────────────────────────────────────────────────────────

export function emitPrintPdf(): string {
  return `window.print();`;
}

// ── pickFile ─────────────────────────────────────────────────────────────────

export function emitPickFile(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const accept = (cfg.accept as string | undefined) ?? '*/*';
  const storeIn = (cfg.storeIn ?? cfg.variableName) as string | undefined;
  const storeIdent = storeIn ? (symbols.vars.get(storeIn) ?? toIdent(storeIn)) : null;
  const onPick = storeIdent
    ? `useStore.setState(s => ({ ...s, variables: { ...s.variables, ${storeIdent}: file } }));`
    : `/* pickFile result not stored */`;
  return [
    `{`,
    `  const _input = document.createElement('input');`,
    `  _input.type = 'file';`,
    `  _input.accept = ${JSON.stringify(accept)};`,
    `  _input.onchange = () => {`,
    `    const file = _input.files?.[0];`,
    `    if (file) { ${onPick} }`,
    `  };`,
    `  _input.click();`,
    `}`,
  ].join('\n');
}

// ── encodeFileAsBase64 ────────────────────────────────────────────────────────

export function emitEncodeBase64(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const dataUrl = rewritePropValue(cfg.dataUrl, symbols);
  const storeIn = (cfg.storeIn ?? cfg.variableName) as string | undefined;
  const storeIdent = storeIn ? (symbols.vars.get(storeIn) ?? toIdent(storeIn)) : null;
  const store = storeIdent
    ? `useStore.setState(s => ({ ...s, variables: { ...s.variables, ${storeIdent}: _b64 } }));`
    : '';
  return [
    `{`,
    `  const _raw = String(${dataUrl} ?? '');`,
    `  const _b64 = _raw.includes(',') ? _raw.split(',')[1] : _raw;`,
    store,
    `}`,
  ].filter(Boolean).join('\n');
}

// ── createUrlFromBase64 ───────────────────────────────────────────────────────

export function emitCreateUrlFromBase64(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const b64Expr = rewritePropValue(cfg.base64, symbols);
  const mime = (cfg.mimeType as string | undefined) ?? 'application/octet-stream';
  const storeIn = (cfg.storeIn ?? cfg.variableName) as string | undefined;
  const storeIdent = storeIn ? (symbols.vars.get(storeIn) ?? toIdent(storeIn)) : null;
  const store = storeIdent
    ? `useStore.setState(s => ({ ...s, variables: { ...s.variables, ${storeIdent}: _url } }));`
    : '';
  return [
    `{`,
    `  const _bytes = atob(String(${b64Expr} ?? ''));`,
    `  const _arr = new Uint8Array(_bytes.length).map((_, i) => _bytes.charCodeAt(i));`,
    `  const _blob = new Blob([_arr], { type: ${JSON.stringify(mime)} });`,
    `  const _url = URL.createObjectURL(_blob);`,
    store,
    `}`,
  ].filter(Boolean).join('\n');
}

// ── emitComponentTrigger / openPopup / closeAllPopups / pageLoader ──────────

export function emitPageLoader(step: Record<string, unknown>): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const show = cfg.show !== false && cfg.visible !== false;
  return `useStore.setState(s => ({ ...s, _pageLoading: ${show} }));`;
}

export function emitOpenPopup(step: Record<string, unknown>): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const id = (cfg.popupId ?? cfg.id ?? '') as string;
  return `setPopoverState(s => ({ ...s, ${JSON.stringify(id)}: true }));`;
}

export function emitCloseAllPopups(): string {
  return `setPopoverState({});`;
}

export function emitEmitComponentTrigger(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const trigger = (cfg.trigger ?? cfg.event ?? '') as string;
  const target = (cfg.targetNodeId ?? cfg.target ?? '') as string;
  if (!trigger) return `/* emitComponentTrigger: no trigger specified */`;
  return `document.getElementById(${JSON.stringify(target)})?.dispatchEvent(new CustomEvent(${JSON.stringify(trigger)}, { bubbles: true }));`;
}

export function emitChangeLanguage(step: Record<string, unknown>): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const lang = (cfg.language ?? cfg.lang ?? 'en') as string;
  return `/* changeLanguage: set locale to "${lang}" — wire to your i18n library */`;
}

export function emitCustomJavaScript(step: Record<string, unknown>, symbols: SymbolMap): string {
  const cfg = step.config as Record<string, unknown> | undefined ?? {};
  const code = (cfg.code ?? cfg.script ?? '') as string;
  if (!code.trim()) return `/* customJavaScript: empty */`;
  const rewritten = rewriteFormula(code, symbols);
  const lines = rewritten.split('\n').map(l => `  ${l}`).join('\n');
  return `await (async () => {\n${lines}\n})();`;
}
