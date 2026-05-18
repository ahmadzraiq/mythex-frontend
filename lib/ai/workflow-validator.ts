/**
 * Shared workflow validation utilities.
 *
 * Importable from both lib/ai/tool-executor.ts (client) and
 * app/api/ai/builder-chat/route.ts (server) without pulling in Zustand.
 *
 * These enforce system-level constraints only — no domain-specific logic.
 */

import { FORMULA_FNS } from '@/lib/sdui/formula-functions';

const KNOWN_FN_NAMES = new Set(Object.keys(FORMULA_FNS));

// `customJavaScript` is the legacy step type — replaced by `runJavaScript`.
// `animate` is a removed canvas step.
export const PROHIBITED_STEP_TYPES = new Set(['customJavaScript', 'animate']);

// Disallowed identifiers/calls for AI-emitted JS bindings and runJavaScript step bodies.
// Each entry: pattern + reason.
const JS_DISALLOWED: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bfetch\s*\(/,            reason: 'Use the fetchData / graphql / refetch workflow steps instead of bare fetch().' },
  { pattern: /\bimport\s*\(/,           reason: 'Dynamic import() is not allowed inside JS bindings.' },
  { pattern: /\brequire\s*\(/,          reason: 'require() is not allowed inside JS bindings.' },
  { pattern: /\bdocument\b/,            reason: 'document is not available — use wwLib helpers instead.' },
  { pattern: /\bwindow\b/,              reason: 'window is not available — use wwLib helpers instead.' },
  { pattern: /\bglobalThis\b/,          reason: 'globalThis is not available — use wwLib helpers instead.' },
  { pattern: /\blocalStorage\b/,        reason: 'localStorage is not available — use a variable with saveInLocalStorage:true instead.' },
  { pattern: /\bsessionStorage\b/,      reason: 'sessionStorage is not available.' },
  { pattern: /\beval\s*\(/,             reason: 'eval() is not allowed.' },
  { pattern: /\bnew\s+Function\b/,      reason: 'new Function(...) is not allowed.' },
  { pattern: /\bprocess\b/,             reason: 'process is not available in JS bindings.' },
];

/**
 * Validates a JavaScript expression body for safety. Returns an error string
 * if disallowed identifiers/calls are present, or null if the body is safe.
 *
 * Used for both inline `{ js: "<body>" }` bindings (sync) and the
 * `runJavaScript` workflow step's `config.code` (async).
 */
export function validateJsBody(code: string): string | null {
  if (typeof code !== 'string') return null;
  for (const { pattern, reason } of JS_DISALLOWED) {
    if (pattern.test(code)) return reason;
  }
  return null;
}

/**
 * Validates a single formula expression string for security and correctness.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateFormula(expr: string): string | null {
  if (/\beval\s*\(/.test(expr)) {
    return 'eval() is not allowed in formulas. Use multiOptionBranch with explicit arithmetic instead: toNumber(variables[\'prevUUID\']) + toNumber(variables[\'currUUID\']), etc.';
  }
  if (/\bMath\s*\./.test(expr)) {
    const matches = expr.match(/\bMath\s*\.\s*(\w+)/g) ?? [];
    const names = matches.map(m => m.replace(/\bMath\s*\.\s*/, ''));
    const suggestions = names.map(n => {
      const lower = n.toLowerCase();
      const found = [...KNOWN_FN_NAMES].find(k => k.toLowerCase() === lower);
      return found ? `Math.${n}() → ${found}()` : `Math.${n}() (not available as a formula function)`;
    });
    return `Formula uses JavaScript globals (${matches.join(', ')}). Use the formula functions directly instead: ${suggestions.join('; ')}. Available math functions: ${[...KNOWN_FN_NAMES].filter(k => ['abs','ceil','floor','round','max','min','clamp','pow','sqrt','mod','sum'].includes(k)).join(', ')}.`;
  }
  // Whitelist: only these event properties are available in formula context
  {
    const ALLOWED_EVENT_PROPS = new Set([
      'value',                                                              // change, focus, blur, valueChange, enterKey
      'x', 'y', 'button',                                                   // click
      'key',                                                                // enterKey
      'scrollTop', 'scrollLeft',                                            // scroll
      'error',                                                              // collectionFetchError
      'translationX', 'translationY', 'percentX', 'percentY', 'velocityX', 'velocityY', // drag
      'direction',                                                          // swipe
    ]);
    const eventProps = [
      ...[...expr.matchAll(/\bevent\s*(?:\?\.)?\s*\.?\s*(\w+)/g)].map(m => m[1]),
      ...[...expr.matchAll(/\bevent\s*(?:\?\.)?\s*\[\s*['"](\w+)['"]\s*\]/g)].map(m => m[1]),
    ].filter((p): p is string => !!p && p !== 'event');
    for (const prop of eventProps) {
      if (!ALLOWED_EVENT_PROPS.has(prop)) {
        return `event.${prop} is not a supported event property. Supported: ${[...ALLOWED_EVENT_PROPS].join(', ')}. Use context?.item?.data?.fieldName for repeat-item values or a hardcoded literal for fixed values.`;
      }
    }
  }
  // Balanced parentheses check — catches truncated switch()/toText()/if() calls.
  // Skip characters inside single-quoted string literals to avoid false positives.
  {
    let depth = 0;
    let inStr = false;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === "'" && (i === 0 || expr[i - 1] !== '\\')) {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth < 0) {
        return `Unbalanced parentheses in formula — extra ')' found. Check all opening '(' have a matching ')'.`;
      }
    }
    if (depth > 0) {
      return `Unbalanced parentheses in formula — ${depth} unclosed '(' found. A closing ')' is likely missing at the end of a switch(), if(), or other nested function call. Count your opening and closing parentheses and fix before retrying.`;
    }
  }
  return null;
}

/**
 * Walks any value recursively and lints every `{ js: "<body>" }` shape it finds.
 * Returns an error string scoped to the path where the violation was found, or null.
 */
function validateJsInValue(value: unknown, pathHint: string): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const err = validateJsInValue(value[i], `${pathHint}[${i}]`);
      if (err) return err;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.js === 'string' && Object.keys(obj).every(k => k === 'js')) {
      const err = validateJsBody(obj.js);
      if (err) return `${pathHint} { js }: ${err}`;
      return null;
    }
    for (const [k, v] of Object.entries(obj)) {
      const err = validateJsInValue(v, `${pathHint}.${k}`);
      if (err) return err;
    }
  }
  return null;
}

/**
 * Validates all changeVariableValue formula steps in a workflow, including nested branches/loops.
 * Also validates `runJavaScript` bodies and any `{ js }` bindings inside step configs.
 * Returns an error string if any step has an invalid formula/JS, or null if all pass.
 */
export function validateWorkflowFormulas(steps: Array<Record<string, unknown>>): string | null {
  for (const step of steps) {
    const stepId = (step.id as string | undefined) ?? '?';
    if (step.type === 'changeVariableValue') {
      const cfg = step.config as Record<string, unknown> | undefined;
      const value = cfg?.value as Record<string, unknown> | undefined;
      if (typeof value?.formula === 'string') {
        const err = validateFormula(value.formula);
        if (err) return `Step "${stepId}": ${err}`;
      }
      if (typeof value?.js === 'string') {
        const err = validateJsBody(value.js);
        if (err) return `Step "${stepId}" { js }: ${err}`;
      }
    }
    // Validate condition formulas in branching/loop steps.
    if (['branch', 'multiOptionBranch', 'whileLoop', 'passThroughCondition'].includes(step.type as string)) {
      const cfg = step.config as Record<string, unknown> | undefined;
      if (typeof cfg?.condition === 'string') {
        const err = validateFormula(cfg.condition);
        if (err) return `Step "${stepId}" condition: ${err}`;
      }
    }
    // runJavaScript step — validate the body.
    if (step.type === 'runJavaScript') {
      const cfg = step.config as Record<string, unknown> | undefined;
      const code = cfg?.code as string | undefined;
      if (typeof code === 'string') {
        const err = validateJsBody(code);
        if (err) return `Step "${stepId}" runJavaScript: ${err}`;
      } else {
        return `Step "${stepId}" runJavaScript: requires "config.code" string.`;
      }
    }
    // Lint any { js: "..." } binding embedded inside the step config.
    if (step.config && typeof step.config === 'object') {
      const err = validateJsInValue(step.config, `Step "${stepId}".config`);
      if (err) return err;
    }
    for (const branch of ['trueBranch', 'falseBranch', 'loopBody', 'defaultBranch'] as const) {
      if (Array.isArray(step[branch])) {
        const err = validateWorkflowFormulas(step[branch] as Array<Record<string, unknown>>);
        if (err) return err;
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Array<Record<string, unknown>>) {
        if (Array.isArray(b.steps)) {
          const err = validateWorkflowFormulas(b.steps as Array<Record<string, unknown>>);
          if (err) return err;
        }
      }
    }
  }
  return null;
}

// ─── Step type allowlist ──────────────────────────────────────────────────────
// The complete set of known valid workflow step types.
// Any type outside this set is almost certainly an AI hallucination.
export const SUPPORTED_STEP_TYPES = new Set([
  // Control flow
  'branch', 'multiOptionBranch', 'forEach', 'whileLoop', 'breakLoop', 'continueLoop',
  'passThroughCondition', 'startLoop', 'stopLoop',
  // Navigation
  'navigateTo', 'navigatePrev', 'pageLoader', 'scrollToElement',
  // Variables / state
  'changeVariableValue', 'setVar', 'cycleIndex', 'resetVariableValue', 'set',
  'appendToPath', 'mergeAtPath', 'clearPersistedPaths',
  // Data
  'fetchCollection', 'fetchCollectionsParallel', 'updateCollection', 'refetchDataSource',
  'fetchData', 'graphql',
  // Actions / execution
  'executeComponentAction', 'returnValue', 'runProjectWorkflow', 'timeDelay',
  'runJavaScript', 'stopPropagation',
  // File / media
  'pickFile', 'encodeFileAsBase64', 'createUrlFromBase64',
  'downloadFileFromUrl', 'printPdf', 'copyToClipboard',
  // UI / animation
  'openPopup', 'closeAllPopups', 'playEnterAnimation', 'triggerExitAnimation',
  'changeLanguage', 'setTheme',
  // Auth / session
  'setUser', 'clearSession', 'restoreSession', 'authenticate', 'validate',
  // Forms
  'setFormState', 'resetForm', 'submitForm',
  // Shared components
  'addSharedComponent', 'deleteSharedComponent', 'deleteAllSharedComponents',
]);

/**
 * Recursively validates that every step uses a known step type.
 * Returns an error string if an unknown type is found, or null if all pass.
 */
export function validateStepTypes(steps: Array<Record<string, unknown>>): string | null {
  for (const step of steps) {
    const t = step.type as string | undefined;
    if (t && !SUPPORTED_STEP_TYPES.has(t)) {
      return `Step "${step.id ?? '?'}": type "${t}" is not a supported workflow step type. Did you mean one of: changeVariableValue, navigateTo, branch, multiOptionBranch, forEach, runJavaScript, fetchData, graphql, fetchCollection? See the full list in the workflow step reference.`;
    }
    for (const branch of ['trueBranch', 'falseBranch', 'loopBody', 'defaultBranch'] as const) {
      if (Array.isArray(step[branch])) {
        const err = validateStepTypes(step[branch] as Array<Record<string, unknown>>);
        if (err) return err;
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Array<Record<string, unknown>>) {
        if (Array.isArray(b.steps)) {
          const err = validateStepTypes(b.steps as Array<Record<string, unknown>>);
          if (err) return err;
        }
      }
    }
  }
  return null;
}

/**
 * Validates that multiOptionBranch steps have at least one branch and a defaultBranch.
 * Returns an error string if a coverage problem is found, or null if all pass.
 */
export function validateMultiOptionBranches(steps: Array<Record<string, unknown>>): string | null {
  for (const step of steps) {
    if (step.type === 'multiOptionBranch') {
      const stepId = (step.id as string | undefined) ?? '?';
      if (!Array.isArray(step.branches) || step.branches.length === 0) {
        return `Step "${stepId}" (multiOptionBranch): "branches" must be a non-empty array. Define at least one branch with a "match" value.`;
      }
      for (const b of step.branches as Array<Record<string, unknown>>) {
        const matchVal = b.match ?? b.label ?? b.value;
        if (matchVal === undefined || matchVal === null || matchVal === '') {
          return `Step "${stepId}" (multiOptionBranch): every branch must have a non-empty "match" field. Found a branch missing "match".`;
        }
      }
      if (!Array.isArray(step.defaultBranch)) {
        return `Step "${stepId}" (multiOptionBranch): missing "defaultBranch" array. Add a defaultBranch (can be empty []) to handle values not matched by any branch.`;
      }
    }
    for (const branch of ['trueBranch', 'falseBranch', 'loopBody', 'defaultBranch'] as const) {
      if (Array.isArray(step[branch])) {
        const err = validateMultiOptionBranches(step[branch] as Array<Record<string, unknown>>);
        if (err) return err;
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Array<Record<string, unknown>>) {
        if (Array.isArray(b.steps)) {
          const err = validateMultiOptionBranches(b.steps as Array<Record<string, unknown>>);
          if (err) return err;
        }
      }
    }
  }
  return null;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Validates that changeVariableValue steps reference a UUID variableName.
 * Returns an error string if a non-UUID variableName is found, or null if all pass.
 */
export function validateChangeVariableUUIDs(steps: Array<Record<string, unknown>>): string | null {
  for (const step of steps) {
    if (step.type === 'changeVariableValue') {
      const stepId = (step.id as string | undefined) ?? '?';
      const cfg = step.config as Record<string, unknown> | undefined;
      const varName = cfg?.variableName as string | undefined;
      if (varName && !UUID_RE.test(varName)) {
        return `Step "${stepId}" (changeVariableValue): "variableName" must be a UUID (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890"). Got "${varName}". Call get_variables to get the correct UUID for the variable you want to update.`;
      }
    }
    for (const branch of ['trueBranch', 'falseBranch', 'loopBody', 'defaultBranch'] as const) {
      if (Array.isArray(step[branch])) {
        const err = validateChangeVariableUUIDs(step[branch] as Array<Record<string, unknown>>);
        if (err) return err;
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Array<Record<string, unknown>>) {
        if (Array.isArray(b.steps)) {
          const err = validateChangeVariableUUIDs(b.steps as Array<Record<string, unknown>>);
          if (err) return err;
        }
      }
    }
  }
  return null;
}

/**
 * Recursively checks all steps (including nested branches/loops) for prohibited types.
 * Returns an error string if any prohibited type is found, or null if all pass.
 */
export function findProhibitedStep(
  steps: Array<Record<string, unknown>>,
  prohibited: Set<string> = PROHIBITED_STEP_TYPES,
): string | null {
  for (const step of steps) {
    const t = step.type as string | undefined;
    if (t && prohibited.has(t)) {
      return `Step "${step.id ?? '?'}": type "${t}" is not supported. Use changeVariableValue, navigateTo, or other supported types instead.`;
    }
    for (const branch of ['trueBranch', 'falseBranch', 'loopBody', 'defaultBranch'] as const) {
      if (Array.isArray(step[branch])) {
        const err = findProhibitedStep(step[branch] as Array<Record<string, unknown>>, prohibited);
        if (err) return err;
      }
    }
    if (Array.isArray(step.branches)) {
      for (const b of step.branches as Array<Record<string, unknown>>) {
        if (Array.isArray(b.steps)) {
          const err = findProhibitedStep(b.steps as Array<Record<string, unknown>>, prohibited);
          if (err) return err;
        }
      }
    }
  }
  return null;
}
