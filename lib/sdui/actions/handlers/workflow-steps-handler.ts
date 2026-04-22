/**
 * Workflow handler — executes an ActionStep[] array from the visual workflow builder.
 *
 * Maps each ActionStepType from the canvas to an equivalent SDUI inline action
 * and dispatches it through the existing runOne pipeline, so all registered
 * handlers (graphql, fetch, navigate, validate, submitForm, etc.) continue to work.
 *
 * After each step, the result/error is written to context.workflow[stepId] in the
 * variable store, making it accessible via formulas like:
 *   context.workflow['step-id'].result?.login?.__typename
 *
 * Each step:
 *   { "id": "...", "type": "ActionStepType", "config": { ...actionParams } }
 */

import type { ActionHandlerContext, ActionDef } from './types';
import { evaluateFormula } from '../../formula-evaluator';
import { getGlobalVariableStore } from '../../global-variable-store';
import { setNestedValue } from '../../nested-utils';
import { buildAuthHeaders, clearStoredToken, setStoredToken, setStoredAuthSnapshot, clearStoredAuthSnapshot, getStoredAuthSnapshot } from '../../auth-token-storage';
import { SUPPORTED_WORKFLOW_STEP_TYPES } from '@/app/dev/builder/_workflow-types';

interface WorkflowStep {
  id: string;
  type: string;
  name?: string;
  disabled?: boolean;
  config?: Record<string, unknown>;
  trueBranch?: WorkflowStep[];
  falseBranch?: WorkflowStep[];
  loopBody?: WorkflowStep[];
  branches?: Array<{ match?: string; label?: string; value?: string; steps?: WorkflowStep[] }>;
  defaultBranch?: WorkflowStep[];
}

/** Thrown by breakLoop steps to exit the nearest enclosing loop. */
class BreakLoopSignal extends Error {
  constructor() { super('__break__'); }
}

/** Thrown by continueLoop steps to skip to the next iteration of the nearest enclosing loop. */
class ContinueLoopSignal extends Error {
  constructor() { super('__continue__'); }
}

/**
 * Thrown by a `returnValue` step to propagate a value back to the caller.
 * Caught by workflowStepsHandler, which forwards it via ctx.setStepResult so
 * the caller's runProjectWorkflow step receives it as context.workflow[stepId].result.
 */
class ReturnValueSignal {
  constructor(public readonly value: unknown) {}
}

export type WorkflowCtx = Record<string, { result: unknown; error: unknown }>;

/** Convert a canvas ActionStep into an inline SDUI action definition.
 *  Only step types in the builder's Type dropdown (SUPPORTED_WORKFLOW_STEP_TYPES) execute.
 *  Hardcoded unsupported types (runMultiple, setVar, increment, etc.) are ignored. */
function stepToSdui(step: WorkflowStep): Record<string, unknown> | null {
  if (!SUPPORTED_WORKFLOW_STEP_TYPES.has(step.type as Parameters<typeof SUPPORTED_WORKFLOW_STEP_TYPES.has>[0])) {
    return null;
  }
  const cfg = step.config ?? {};

  switch (step.type) {
    // ── Navigation ──────────────────────────────────────────────────────────
    case 'navigateTo':
      // Visual builder's navigation step: supports both plain paths and queryParams
      if (cfg.queryParams) {
        return { type: 'navigateWithQuery', path: cfg.path, queryParams: cfg.queryParams, replace: cfg.replace };
      }
      // Use type:'navigate' so the inline fallback in runOne resolves the navigate handler directly.
      // Using { action:'navigate' } would look up actionsConfig['navigate'] (undefined) and throw.
      return { type: 'navigate', path: cfg.path, linkType: cfg.linkType, externalUrl: cfg.externalUrl, newTab: cfg.newTab };
    case 'navigatePrev':
    case 'navigatePreviousPage':
      // Go back in browser history; fall back to defaultPath if no history
      return { type: 'navigatePrev', defaultPath: (cfg.defaultPath as string) || '/' };
    // ── Data / API ───────────────────────────────────────────────────────────
    case 'graphql':
      return { type: 'graphql', ...cfg };
    case 'fetchData':
      return { type: 'fetch', ...cfg };
    case 'fetchCollection':
      // New format (builder): cfg.collectionId = datasource UUID → trigger refetch directly
      if (cfg.collectionId) {
        return { type: 'refetchDataSource', name: cfg.collectionId as string };
      }
      // Old format: cfg.collectionName = action UUID → call via action lookup (backward compat)
      return { action: (cfg.collectionName ?? cfg.name ?? '') as string };
    case 'fetchCollectionsParallel': {
      // New format (builder): cfg.collections = datasource UUIDs → refetch each directly
      if (Array.isArray(cfg.collections) && (cfg.collections as string[]).some(Boolean)) {
        const actions = (cfg.collections as string[]).filter(Boolean).map(id => ({ type: 'refetchDataSource', name: id }));
        return actions.length > 0 ? { type: 'runMultiple', actions } : null;
      }
      // Old format: cfg.collectionNames = action UUIDs → call via action lookup (backward compat)
      const names = (cfg.collectionNames ?? []) as string[];
      const actions = names.filter(Boolean).map((name) => ({ action: name }));
      return actions.length > 0 ? { type: 'runMultiple', actions } : null;
    }
    case 'executeComponentAction':
      // Handled inline in runSteps — return null so stepToSdui does not dispatch it.
      return null;
    case 'updateCollection': {
      // New format (builder): cfg.collectionId = datasource UUID → trigger refetch directly
      if (cfg.collectionId) {
        return { type: 'refetchDataSource', name: cfg.collectionId as string, ...cfg };
      }
      // Old format: cfg.name = action UUID → call via action lookup (backward compat)
      if (cfg.name && !cfg.collectionId) {
        return { action: cfg.name as string };
      }
      return { type: 'refetchDataSource', ...cfg };
    }

    // ── Variables ────────────────────────────────────────────────────────────
    case 'changeVariableValue':
      // Visual builder's primary variable-change step
      return { type: 'setVar', path: (cfg.variableName ?? cfg.variable) as string, value: unwrapFormulaValue(cfg.value) };
    case 'resetVariableValue':
    case 'resetVariable':
      return { type: 'setVar', path: (cfg.variableName ?? cfg.path) as string, value: cfg.defaultValue ?? null };

    // ── Project workflow reference (legacy builder format) ───────────────────
    case 'runProjectWorkflow': {
      const wfId = (cfg.workflowId ?? cfg.workflowName ?? (step as unknown as Record<string, unknown>).action ?? '') as string;
      // Resolve param values — each may be a plain value or a FormulaValue object
      const rawParams = cfg.params as Record<string, unknown> | undefined;
      const resolvedParams: Record<string, unknown> | undefined = rawParams
        ? Object.fromEntries(
            Object.entries(rawParams).map(([k, v]) => [
              k,
              v && typeof v === 'object' && 'formula' in (v as Record<string, unknown>)
                ? (v as Record<string, unknown>).formula  // formula string — engine will evaluate in called workflow
                : v,
            ])
          )
        : undefined;
      return {
        action: wfId,
        ...(resolvedParams && Object.keys(resolvedParams).length > 0 ? { payload: { parameters: resolvedParams } } : {}),
      };
    }

    // ── Forms (when in FormContainer) ────────────────────────────────────────
    case 'setFormState':
      // When path+value are specified, the step is pre-populating a variable/field.
      // Map to setVar so the variable store is updated (prevents no-op + infinite fallback loop).
      if (cfg.path != null && cfg.value !== undefined) {
        return { type: 'setVar', path: cfg.path as string, value: cfg.value };
      }
      return { type: 'setFormState', ...cfg };
    case 'resetForm':
      return { type: 'resetForm', ...cfg };

    // ── Workflow control ─────────────────────────────────────────────────────
    case 'executeWorkflow':
      return { action: (cfg.workflowId ?? cfg.workflowName ?? '') as string, payload: cfg.params as Record<string, unknown> };
    case 'returnValue':
      // Evaluate the formula via the normal setVar path; parameters are already in
      // the variable store. After runOne the signal is thrown in runSteps.
      // NOTE: path must be dot-free — setNestedValue splits by '.' so '__wf.return__'
      // would write state.__wf.return__ (nested) but we read back as a flat key.
      return { type: 'setVar', path: '__wfReturn', value: cfg.value };

    // ── Shared Component ─────────────────────────────────────────────────────
    case 'addSharedComponent':
      return { type: 'addSharedComponent', ...cfg };
    case 'deleteSharedComponent':
      return { type: 'deleteSharedComponent', ...cfg };
    case 'deleteAllSharedComponents':
      return { type: 'deleteAllSharedComponents', ...cfg };

    // ── Popover ───────────────────────────────────────────────────────────
    case 'openPopover':
      return { type: 'openPopover', ...cfg };
    case 'closePopover':
      return { type: 'closePopover', ...cfg };
    case 'togglePopover':
      return { type: 'togglePopover', ...cfg };

    // ── Misc ─────────────────────────────────────────────────────────────────
    case 'stopPropagation':
      // Propagation stopping happens at the DOM event level; no-op here
      return null;
    case 'printPdf':
      return { type: '__printPdf' };
    case 'copyToClipboard':
      return { type: '__copyToClipboard', value: cfg.value };
    case 'downloadFileFromUrl':
      return { type: '__downloadCsv', ...cfg };
    case 'encodeFileAsBase64':
      return { type: '__encodeBase64', ...cfg };
    case 'createUrlFromBase64':
      return { type: '__createUrlFromBase64', ...cfg };
    case 'uploadFile':
      return { type: '__uploadFile', ...cfg };
    case 'scrollToElement':
      return null; // handled inline in runSteps

    // ── Structural / utility (handled in runSteps, not via stepToSdui) ────────
    case 'branch':
    case 'forEach':
    case 'whileLoop':
    case 'breakLoop':
    case 'continueLoop':
    case 'passThroughCondition':
    case 'unconfigured':
      return null;

    default:
      return null;
  }
}

/**
 * Resolves a condition/formula field to a plain formula string.
 * Accepts a plain string, a { formula: "..." } object, or a JSON-stringified
 * version of the formula object — all three are normalised to the formula string.
 */
function resolveFormulaToString(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'object' && raw !== null) {
    const f = (raw as Record<string, unknown>).formula;
    return typeof f === 'string' ? f : undefined;
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('{')) {
      try {
        const parsed = JSON.parse(t);
        if (typeof parsed === 'object' && parsed !== null && typeof (parsed as Record<string, unknown>).formula === 'string') {
          return (parsed as Record<string, unknown>).formula as string;
        }
      } catch { /* not JSON — treat as plain formula string */ }
    }
    return t;
  }
  return undefined;
}

/**
 * Normalises a value field so { "formula": "..." } objects and
 * JSON-stringified equivalents are returned as actual formula objects
 * for setVar to evaluate. Static literals are returned unchanged.
 */
function unwrapFormulaValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const t = raw.trim();
  if (t.startsWith('{')) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === 'object' && parsed !== null && 'formula' in (parsed as object)) {
        return parsed;
      }
    } catch { /* not JSON */ }
  }
  return raw;
}

/** Write the current workflowCtx snapshot to the variable store so formulas
 *  in subsequent steps can access context.workflow['stepId'].result. */
function flushWorkflowCtx(workflowCtx: WorkflowCtx) {
  getGlobalVariableStore().getState().setState((prev) =>
    setNestedValue(prev, 'context.workflow', { ...(workflowCtx) })
  );
}

/**
 * Build a formula evaluation context that merges the global variable store
 * with the action handler scope (which carries context.item.data.* from
 * repeat-template clicks). Without scope, context?.item?.data?.type in
 * branch/multiOptionBranch conditions always resolves to undefined.
 *
 * When `parameters` is provided (global workflow called with params), it is
 * injected into the context so `parameters['name']` resolves correctly.
 */
function buildFormulaCtx(
  vsState: Record<string, unknown>,
  ctx: ActionHandlerContext,
  parameters?: Record<string, unknown>,
): Record<string, unknown> {
  // When the scope refers to a shared-component instance, always read the
  // latest per-instance variables from the global store. Formulas inside a
  // workflow can write to these variables step-by-step; each subsequent
  // step's formula must see the up-to-date value, not a snapshot.
  let scopeCtx = (ctx.scope?.context as Record<string, unknown> | undefined) ?? {};
  const compInfo = scopeCtx.component as Record<string, unknown> | undefined;
  const instanceId = compInfo?.instanceId as string | undefined;
  if (instanceId) {
    try {
      const instances = (vsState['_componentInstances'] as Record<string, Record<string, unknown>> | undefined) ?? {};
      const liveVars = instances[instanceId] ?? {};
      scopeCtx = {
        ...scopeCtx,
        component: {
          ...(compInfo ?? {}),
          variables: liveVars,
        },
      };
    } catch { /* non-fatal */ }
  }
  return {
    ...vsState,
    variables: vsState,
    ...(ctx.scope ?? {}),
    ...(parameters ? { parameters } : {}),
    context: scopeCtx,
  };
}

/** Recursively execute a list of workflow steps.
 *  workflowCtx is passed by reference so branch/loop sub-steps share the same map.
 *  parameters — resolved global-workflow param values, injected into formula context.
 *  Returns the last non-null step result so workflowStepsHandler can auto-forward it
 *  to the caller (no explicit returnValue step needed). */
async function runSteps(
  steps: WorkflowStep[],
  ctx: ActionHandlerContext,
  workflowCtx: WorkflowCtx,
  parameters?: Record<string, unknown>,
): Promise<unknown> {
  let lastResult: unknown = undefined;
  for (const step of steps) {
    if (step.disabled) continue;

    // ── Structural: True/False branch ────────────────────────────────────────
    // Exactly two outputs: True and False. Condition is a formula string that
    // can reference context.workflow['prevStepId'].result — no "on error" or
    // "default" branches; the formula itself handles error cases.
    if (step.type === 'branch') {
      const condFormula = resolveFormulaToString(step.config?.condition);
      const condPath    = step.config?.conditionPath as string | undefined;
      let condResult: unknown;
      if (condFormula) {
        const vsState = getGlobalVariableStore().getState().getFullState();
        const formulaCtx = buildFormulaCtx(vsState, ctx, parameters);
        condResult = evaluateFormula(condFormula, formulaCtx).value;
      } else {
        condResult = condPath ? ctx.get(condPath) : false;
      }
      const branch = condResult ? (step.trueBranch ?? []) : (step.falseBranch ?? step.defaultBranch ?? []);
      await runSteps(branch, ctx, workflowCtx, parameters);
      continue;
    }

    // ── Structural: For-each loop ─────────────────────────────────────────────
    if (step.type === 'forEach') {
      // Resolve the items array from whichever source is configured:
      //   items      — FormulaValue set by the builder (formula object or plain string/UUID)
      //   list       — inline array literal
      //   itemsPath  — variable UUID passed to ctx.get()
      //   listPath   — alias for itemsPath
      const rawItems = step.config?.items;
      const inlineList = step.config?.list;
      const itemsPath = ((step.config?.itemsPath ?? step.config?.listPath) as string) ?? '';
      let items: unknown[] = [];
      if (rawItems !== undefined && rawItems !== null && rawItems !== '') {
        if (Array.isArray(rawItems)) {
          items = rawItems;
        } else if (typeof rawItems === 'object' && 'formula' in (rawItems as object)) {
          const fullState = getGlobalVariableStore().getState().getFullState();
          const resolved = evaluateFormula(rawItems as Record<string, unknown>, fullState);
          items = Array.isArray(resolved) ? resolved : [];
        } else if (typeof rawItems === 'string') {
          // Try as a variable UUID / state path first, then as JSON literal
          const fromState = ctx.get(rawItems) as unknown;
          if (Array.isArray(fromState)) {
            items = fromState;
          } else {
            try { const parsed = JSON.parse(rawItems); if (Array.isArray(parsed)) items = parsed; } catch { /* not JSON */ }
          }
        }
      } else if (Array.isArray(inlineList)) {
        items = inlineList;
      } else if (itemsPath) {
        items = (ctx.get(itemsPath) as unknown[]) ?? [];
      }
      if (Array.isArray(items)) {
        for (let i = 0; i < items.length; i++) {
          // Expose current item via context.item.data so formulas like
          // context.item.data.value work inside the loop body
          getGlobalVariableStore().getState().setState(prev =>
            setNestedValue(prev, 'context.item', { data: { value: items[i], index: i }, index: i, repeatIndex: i })
          );
          try {
            await runSteps(step.loopBody ?? [], ctx, workflowCtx, parameters);
          } catch (e) {
            if (e instanceof ContinueLoopSignal) continue;
            if (e instanceof BreakLoopSignal) break;
            throw e;
          }
        }
        // Clear context.item after loop so stale data doesn't linger
        getGlobalVariableStore().getState().setState(prev =>
          setNestedValue(prev, 'context.item', null)
        );
      }
      continue;
    }

    // ── Structural: While loop ────────────────────────────────────────────────
    if (step.type === 'whileLoop') {
      const condPath = (step.config?.conditionPath as string) ?? '';
      const condFormula = resolveFormulaToString(step.config?.condition);
      let guard = 0; // safety limit
      const checkCond = () => {
        if (condFormula) {
          const vsState = getGlobalVariableStore().getState().getFullState();
          const formulaCtx = buildFormulaCtx(vsState, ctx, parameters);
          return Boolean(evaluateFormula(condFormula, formulaCtx).value);
        }
        return condPath ? Boolean(ctx.get(condPath)) : false;
      };
      while (checkCond() && guard < 100) {
        try {
          await runSteps(step.loopBody ?? [], ctx, workflowCtx, parameters);
        } catch (e) {
          if (e instanceof ContinueLoopSignal) { guard++; continue; }
          if (e instanceof BreakLoopSignal) break;
          throw e;
        }
        guard++;
      }
      continue;
    }

    // ── Structural: Loop control ─────────────────────────────────────────────
    if (step.type === 'breakLoop') {
      throw new BreakLoopSignal();
    }

    if (step.type === 'continueLoop') {
      throw new ContinueLoopSignal();
    }

    // ── Structural: Pass-through condition ───────────────────────────────────
    // If the condition is false, stop executing further steps in the current
    // sequence (return from runSteps). If true, continue to next step.
    if (step.type === 'passThroughCondition') {
      const condFormula = resolveFormulaToString(step.config?.condition);
      const condPath = step.config?.conditionPath as string | undefined;
      let condResult: unknown;
      if (condFormula) {
        const vsState = getGlobalVariableStore().getState().getFullState();
        const formulaCtx = buildFormulaCtx(vsState, ctx, parameters);
        condResult = evaluateFormula(condFormula, formulaCtx).value;
      } else {
        condResult = condPath ? ctx.get(condPath) : false;
      }
      if (!condResult) return; // stop current steps sequence
      continue;
    }

    // ── Structural: Multi-option branch ─────────────────────────────────────
    // Evaluates conditionPath (a variable UUID), matches its value against
    // each branch's label, runs the matched branch or defaultBranch.
    if (step.type === 'multiOptionBranch') {
      const conditionPath = step.config?.conditionPath as string | undefined;
      const conditionFormula = resolveFormulaToString(step.config?.condition);
      let value: unknown;
      if (conditionFormula) {
        const vsState = getGlobalVariableStore().getState().getFullState();
        const formulaCtx = buildFormulaCtx(vsState, ctx, parameters);
        value = evaluateFormula(conditionFormula, formulaCtx).value;
      } else if (conditionPath) {
        value = ctx.get(conditionPath);
      }
      const branches = step.branches ?? [];
      const matched = branches.find(b => String(b.match ?? b.label ?? b.value ?? '') === String(value ?? ''));
      await runSteps(matched ? (matched.steps ?? []) : (step.defaultBranch ?? []), ctx, workflowCtx, parameters);
      continue;
    }

    // ── Inline actions ────────────────────────────────────────────────────────
    if (step.type === 'timeDelay') {
      const ms = Number((step.config?.time ?? step.config?.ms) ?? 1000);
      await new Promise<void>(resolve => setTimeout(resolve, ms));
      continue;
    }

    if (step.type === 'copyToClipboard') {
      const value = String(step.config?.value ?? '');
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(value).catch(() => { /* silent fail */ });
      }
      continue;
    }

    if (step.type === 'navigatePreviousPage' || step.type === 'navigatePrev') {
      if (typeof window !== 'undefined') {
        const defaultPath = (step.config?.defaultPath as string) || '/';
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = defaultPath;
        }
      }
      continue;
    }

    // External URL navigation — cfg stores externalUrl + linkType:'external'
    if (step.type === 'navigateTo' && ((step.config?.linkType as string) === 'external' || step.config?.externalUrl)) {
      const url = String(step.config?.externalUrl ?? step.config?.path ?? '');
      const newTab = (step.config?.newTab as boolean | undefined) !== false; // default: new tab
      if (url && typeof window !== 'undefined') {
        window.open(url, newTab ? '_blank' : '_self', 'noopener,noreferrer');
      }
      continue;
    }

    if (step.type === 'printPdf') {
      if (typeof window !== 'undefined') {
        // Snapshot the theme class before the print dialog opens.
        // The browser's beforeprint/afterprint events trigger a prefers-color-scheme change which
        // NativeWind/GluestackUIProvider picks up. GluestackUIProvider re-applies the system
        // theme class on every React render, so a single deferred enforce is not enough —
        // multiple renders can keep re-adding/removing 'dark'. Guard with a MutationObserver
        // that immediately reverts any class flip and stays active for 600ms after print ends
        // to cover all pending React commits.
        const html = document.documentElement;
        const wasDark = html.classList.contains('dark');
        const enforce = () => {
          if (html.classList.contains('dark') !== wasDark) {
            if (wasDark) html.classList.add('dark');
            else html.classList.remove('dark');
          }
        };
        const observer = new MutationObserver(enforce);
        observer.observe(html, { attributes: true, attributeFilter: ['class'] });

        let guardTimer: ReturnType<typeof setTimeout> | null = null;
        const stopGuard = () => {
          if (guardTimer) { clearTimeout(guardTimer); guardTimer = null; }
          observer.disconnect();
          window.removeEventListener('beforeprint', enforce);
          window.removeEventListener('afterprint', scheduleStopGuard);
          enforce();
        };
        const scheduleStopGuard = () => {
          // Keep the observer alive for 600ms after afterprint so all React re-renders settle
          if (guardTimer) clearTimeout(guardTimer);
          guardTimer = setTimeout(stopGuard, 600);
        };

        window.addEventListener('beforeprint', enforce);
        window.addEventListener('afterprint', scheduleStopGuard);
        window.print();
        // Trigger the guard window immediately for browsers where afterprint fired
        // synchronously inside window.print() (or never fires)
        scheduleStopGuard();
      }
      continue;
    }

    if (step.type === 'createUrlFromBase64') {
      const base64 = String(step.config?.base64 ?? step.config?.value ?? '');
      const mimeType = String(step.config?.mimeType ?? step.config?.mime ?? 'application/octet-stream');
      const storeIn = step.config?.storeIn as string | undefined;
      if (base64 && storeIn) {
        const dataUrl = `data:${mimeType};base64,${base64}`;
        getGlobalVariableStore().getState().setState(prev => ({ ...prev, [storeIn]: dataUrl }));
        if (step.id) {
          workflowCtx[step.id] = { result: dataUrl, error: null };
          flushWorkflowCtx(workflowCtx);
        }
      }
      continue;
    }

    if (step.type === 'encodeFileAsBase64') {
      const dataUrl = String(step.config?.fileObject ?? step.config?.dataUrl ?? step.config?.value ?? '');
      const storeIn = step.config?.storeIn as string | undefined;
      if (dataUrl && storeIn) {
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        getGlobalVariableStore().getState().setState(prev => ({ ...prev, [storeIn]: base64 ?? '' }));
        if (step.id) {
          workflowCtx[step.id] = { result: base64 ?? '', error: null };
          flushWorkflowCtx(workflowCtx);
        }
      }
      continue;
    }

    // ── Scroll to element by selector or data-builder-id ────────────────────
    if (step.type === 'scrollToElement') {
      const targetId = String(step.config?.elementId ?? step.config?.targetId ?? '');
      const behavior = (step.config?.behavior as ScrollBehavior | undefined) ?? 'smooth';
      const block = (step.config?.block as ScrollLogicalPosition | undefined) ?? 'start';
      if (targetId && typeof document !== 'undefined') {
        const el = document.getElementById(targetId)
          ?? document.querySelector(`[data-section-id="${targetId}"]`) as HTMLElement | null;
        if (el) el.scrollIntoView({ behavior, block });
      }
      continue;
    }

    // ── Auth: authenticate ────────────────────────────────────────────────────
    if (step.type === 'authenticate') {
      const cfg = step.config ?? {};
      const vsState = getGlobalVariableStore().getState().getFullState();
      const formulaCtx = buildFormulaCtx(vsState, ctx, parameters);
      const persist = cfg.persist !== false;

      const accessTokenFormula = resolveFormulaToString(cfg.accessToken);
      const refreshTokenFormula = resolveFormulaToString(cfg.refreshToken);
      const userFormula = resolveFormulaToString(cfg.user);

      const accessToken = accessTokenFormula ? evaluateFormula(accessTokenFormula, formulaCtx).value : (cfg.accessToken as unknown ?? null);
      const refreshToken = refreshTokenFormula ? evaluateFormula(refreshTokenFormula, formulaCtx).value : (cfg.refreshToken as unknown ?? null);
      const user = userFormula ? evaluateFormula(userFormula, formulaCtx).value : (cfg.user as unknown ?? null);

      if (persist && accessToken && typeof window !== 'undefined') {
        setStoredToken(String(accessToken));
      }
      ctx.setData('auth.user', user);
      ctx.setData('auth.accessToken', accessToken);
      ctx.setData('auth.token', accessToken);
      ctx.setData('auth.refreshToken', refreshToken ?? null);
      ctx.setData('sessionRestored', true);
      if (persist && (user || accessToken)) {
        setStoredAuthSnapshot({ user, accessToken, refreshToken: refreshToken ?? null });
      }
      if (step.id) {
        workflowCtx[step.id] = { result: { user, accessToken }, error: null };
        flushWorkflowCtx(workflowCtx);
      }
      continue;
    }

    // ── Auth: setUser ─────────────────────────────────────────────────────────
    if (step.type === 'setUser') {
      const cfg = step.config ?? {};
      const vsState = getGlobalVariableStore().getState().getFullState();
      const formulaCtx = buildFormulaCtx(vsState, ctx, parameters);
      const userFormula = resolveFormulaToString(cfg.user);
      const user = userFormula ? evaluateFormula(userFormula, formulaCtx).value : (cfg.user as unknown ?? null);
      ctx.setData('auth.user', user);
      ctx.setData('sessionRestored', true);
      // Update the snapshot with the user (preserving existing token),
      // but ONLY if a snapshot already exists — meaning authenticate ran with
      // persist: true. If authenticate had persist: false, no snapshot was
      // created and setUser must not create one either.
      if (user) {
        const existingSnapshot = getStoredAuthSnapshot();
        if (existingSnapshot) {
          setStoredAuthSnapshot({
            user,
            accessToken: existingSnapshot.accessToken ?? null,
            refreshToken: existingSnapshot.refreshToken ?? null,
          });
        }
      }
      if (step.id) {
        workflowCtx[step.id] = { result: user, error: null };
        flushWorkflowCtx(workflowCtx);
      }
      continue;
    }

    // ── Auth: clearSession ────────────────────────────────────────────────────
    if (step.type === 'clearSession') {
      // Clear Zustand auth state
      ctx.setData('auth.user', null);
      ctx.setData('auth.accessToken', null);
      ctx.setData('auth.token', null);               // alias for backward-compat ({{auth.token}})
      ctx.setData('auth.refreshToken', null);
      ctx.setData('sessionRestored', true);
      // Clear bearer token and auth snapshot from localStorage
      clearStoredToken();
      clearStoredAuthSnapshot();
      if (step.id) {
        workflowCtx[step.id] = { result: null, error: null };
        flushWorkflowCtx(workflowCtx);
      }
      continue;
    }

    // ── Auth: restoreSession ──────────────────────────────────────────────────
    if (step.type === 'restoreSession') {
      const authCfg = (ctx as ActionHandlerContext & { getAuthConfig?: () => import('../../engine-types').AuthConfig }).getAuthConfig?.();

      // If no user endpoint is configured, nothing to restore — mark done and continue.
      const hasUserEndpoint = !!(authCfg?.userQuery ?? authCfg?.userEndpoint);
      if (!hasUserEndpoint) {
        ctx.setData('sessionRestored', true);
        if (step.id) {
          workflowCtx[step.id] = { result: null, error: null };
          flushWorkflowCtx(workflowCtx);
        }
        continue;
      }

      // Try to validate the session by fetching the current user.
      // When bearer tokens are used, inject the stored token. For persist: false
      // logins the token is in-memory only (not in localStorage), so fall back to
      // ctx.get('auth.accessToken') — which reads the live Zustand store — before
      // giving up. This lets restoreSession work across client-side navigations
      // even when persist is off. On a hard page refresh with persist: false the
      // store is empty too, so no token is found and the user must log in again
      // (correct behaviour — "no persist" means session-only).
      try {
        let userData: unknown = null;

        // Build effective auth headers: localStorage → in-memory Zustand → nothing.
        const baseHeaders = buildAuthHeaders(authCfg);
        let effectiveAuthHeaders = baseHeaders;
        if (!Object.keys(effectiveAuthHeaders).length) {
          const memToken = ctx.get('auth.accessToken') as string | null;
          if (memToken && typeof memToken === 'string' && authCfg?.tokenSend) {
            const header = authCfg.tokenSend.header ?? 'Authorization';
            const prefix = authCfg.tokenSend.prefix ?? 'Bearer ';
            effectiveAuthHeaders = { [header]: `${prefix}${memToken}` };
          } else if (memToken && typeof memToken === 'string') {
            effectiveAuthHeaders = { Authorization: `Bearer ${memToken}` };
          }
        }

        if (authCfg?.userQuery) {
          const endpoint = authCfg.userQueryEndpoint ?? (ctx as ActionHandlerContext & { getGraphqlEndpoint?: () => string }).getGraphqlEndpoint?.() ?? '/graphql';
          const extraHeaders = authCfg.userQueryHeaders ?? (ctx as ActionHandlerContext & { getGraphqlHeaders?: () => Record<string, string> }).getGraphqlHeaders?.() ?? {};
          const headers: Record<string, string> = { 'Content-Type': 'application/json', ...effectiveAuthHeaders, ...extraHeaders };
          const response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ query: authCfg.userQuery }),
          });
          const json = await response.json() as { data?: Record<string, unknown>; errors?: unknown[] };
          if (!json.errors?.length && json.data) {
            const dataKeys = Object.keys(json.data);
            userData = dataKeys.length > 0 ? json.data[dataKeys[0]] : null;
          }
        } else if (authCfg?.userEndpoint) {
          const response = await fetch(authCfg.userEndpoint, {
            credentials: 'include',
            headers: Object.keys(effectiveAuthHeaders).length ? effectiveAuthHeaders : undefined,
          });
          if (response.ok) {
            userData = await response.json();
          }
        }

        if (userData) {
          ctx.setData('auth.user', userData);
        } else {
          ctx.setData('auth.user', null);
          ctx.setData('auth.accessToken', null);
          ctx.setData('auth.token', null);
        }
      } catch {
        ctx.setData('auth.user', null);
        ctx.setData('auth.accessToken', null);
        ctx.setData('auth.token', null);
      }
      ctx.setData('sessionRestored', true);
      if (step.id) {
        workflowCtx[step.id] = { result: null, error: null };
        flushWorkflowCtx(workflowCtx);
      }
      continue;
    }

    // ── Execute component workflow (executeComponentAction) ───────────────────
    // ── executeComponentAction: invoke a scoped workflow by workflowId ───────────
    if (step.type === 'executeComponentAction') {
      const cfg = (step.config ?? {}) as Record<string, unknown>;
      const workflowId = (cfg.workflowId ?? cfg.action) as string | undefined;
      const componentCtx = (ctx.scope?.context as Record<string, unknown> | undefined) ?? {};
      const compInfo = (componentCtx.component ?? {}) as Record<string, unknown>;
      // Allow an explicit instanceId override from the step config so an
      // external (page/global) workflow can target a specific SC instance.
      // Falls back to the ambient scope when called from inside the SC.
      const instanceId = (cfg.instanceId as string | undefined) ?? (compInfo.instanceId as string | undefined);
      const modelId = (cfg.modelId ?? compInfo.id) as string | undefined;

      if (typeof window !== 'undefined') {
        console.log('[executeComponentAction] step:', {
          stepId: step.id,
          workflowId,
          modelId,
          instanceId,
          cfgArgs: cfg.args,
          ambientComponentId: compInfo.id,
        });
      }

      if (workflowId && modelId) {
        let scModel: { workflows?: Record<string, { steps: WorkflowStep[]; params?: Array<{ name: string }> }> } | undefined;
        try { scModel = require('@/lib/builder/shared-component-data').getSharedComponents()[modelId]; } catch { /* noop */ }
        if (!scModel) { try { scModel = require('@/config/shared-components.json')[modelId]; } catch { /* noop */ } }

        const wf = scModel?.workflows?.[workflowId];
        if (typeof window !== 'undefined') {
          console.log('[executeComponentAction] model lookup:', {
            modelId,
            modelFound: !!scModel,
            availableWorkflows: scModel?.workflows ? Object.keys(scModel.workflows) : [],
            workflowFound: !!wf,
            stepCount: wf?.steps?.length ?? 0,
          });
        }
        if (wf?.steps) {
          const vsState = getGlobalVariableStore().getState().getFullState();

          // Read LIVE instance variables from _componentInstances so formulas
          // referencing context.component.variables['UUID'] always see the
          // current value — not a stale snapshot captured at click time.
          let liveInstanceVars: Record<string, unknown> = {};
          if (instanceId) {
            try {
              const { getComponentInstanceVars } = require('@/lib/sdui/global-variable-store') as typeof import('@/lib/sdui/global-variable-store');
              liveInstanceVars = getComponentInstanceVars(instanceId) ?? {};
            } catch { /* non-fatal */ }
          }

          // Build a formula context that carries the LIVE variables (not
          // whatever was snapshotted on ctx.scope.context.component.variables).
          const ctxWithLiveVars: ActionHandlerContext = {
            ...ctx,
            scope: {
              ...(ctx.scope ?? {}),
              context: {
                ...componentCtx,
                component: {
                  ...(compInfo ?? {}),
                  id: modelId,
                  instanceId,
                  variables: liveInstanceVars,
                },
              },
            },
          };
          const formulaCtx = buildFormulaCtx(vsState, ctxWithLiveVars, parameters);
          const resolvedArgs: Record<string, unknown> = {};
          if (cfg.args && typeof cfg.args === 'object') {
            for (const [k, v] of Object.entries(cfg.args as Record<string, unknown>)) {
              resolvedArgs[k] = typeof v === 'object' && v !== null && 'formula' in (v as object)
                ? evaluateFormula((v as { formula: string }).formula, formulaCtx).value
                : v;
            }
          }
          const componentScope = {
            ...(ctx.scope ?? {}),
            // Expose resolvedArgs as `parameters` on ctx.scope so setVarHandler's
            // evalCtx (which spreads ctx.scope) can resolve `parameters['name']`
            // formulas. Without this, changeVariableValue steps referencing
            // parameters inside a component workflow would see undefined.
            parameters: resolvedArgs,
            context: {
              ...componentCtx,
              params: resolvedArgs,
              component: { ...compInfo, id: modelId, instanceId, variables: liveInstanceVars },
            },
          };
          const subCtx = { ...ctx, scope: componentScope };
          const subWorkflowCtx: WorkflowCtx = {};

          // Also write parameters into the global variable store so formula
          // evaluators that don't see ctx.scope directly (e.g. graphql variables)
          // still pick them up. Restore the previous value afterwards so nested
          // component workflow calls don't bleed parameters across siblings.
          const prevParameters = getGlobalVariableStore().getState().getFullState()['parameters'];
          getGlobalVariableStore().getState().setState(prev =>
            setNestedValue(prev, 'parameters', resolvedArgs)
          );

          let stepResult: unknown = undefined;
          let stepError: unknown = null;
          try {
            stepResult = await runSteps(wf.steps, subCtx as ActionHandlerContext, subWorkflowCtx, resolvedArgs);
          } catch (err) {
            stepError = err instanceof Error ? err.message : String(err);
          } finally {
            getGlobalVariableStore().getState().setState(prev =>
              setNestedValue(prev, 'parameters', prevParameters ?? null)
            );
          }
          if (step.id) {
            workflowCtx[step.id] = { result: stepResult ?? null, error: stepError };
            flushWorkflowCtx(workflowCtx);
          }
        }
      }
      continue;
    }

    // ── Raw ActionRef (serialized runNamedAction: { action: "name" }) ─────────
    if (!step.type && (step as unknown as Record<string, unknown>).action) {
      const result = await ctx.runOne(step as unknown as unknown as import('../../types').SDUIAction);
      if (step.id) {
        workflowCtx[step.id] = { result: result ?? null, error: null };
        flushWorkflowCtx(workflowCtx);
      }
      if (result != null) lastResult = result;
      continue;
    }

    // ── Dispatch to existing SDUI handler ─────────────────────────────────────
    const sduiDef = stepToSdui(step);
    if (sduiDef) {
      let stepResult: unknown = undefined;
      let stepError: unknown = null;
      try {
        stepResult = await ctx.runOne(sduiDef as unknown as import('../../types').SDUIAction);
      } catch (err) {
        stepError = err instanceof Error ? err.message : String(err);
      }
      workflowCtx[step.id] = { result: stepResult ?? null, error: stepError };
      flushWorkflowCtx(workflowCtx);
      // Track the last meaningful result so the caller can access it without
      // an explicit returnValue step (auto-return of last step result).
      if (stepResult != null && !stepError) lastResult = stepResult;
    }

    // returnValue: explicit early-return with a specific value — takes priority
    // over the auto-return mechanism above.
    if (step.type === 'returnValue') {
      throw new ReturnValueSignal(
        getGlobalVariableStore().getState().getFullState()['__wfReturn'] ?? null
      );
    }
  }
  return lastResult;
}

export const workflowStepsHandler =
  (ctx: ActionHandlerContext) =>
  async (actionDef: ActionDef): Promise<void> => {
    const steps = (actionDef.steps ?? []) as WorkflowStep[];
    if (typeof window !== 'undefined') {
      console.log('[workflowStepsHandler] invoked:', {
        action: (actionDef as Record<string, unknown>).name ?? (actionDef as Record<string, unknown>).id,
        trigger: (actionDef as Record<string, unknown>).trigger,
        stepCount: steps.length,
        stepTypes: steps.map(s => (s as unknown as Record<string, unknown>).type ?? (s as unknown as Record<string, unknown>).action),
        payloadParams: ctx.payload?.parameters,
      });
    }
    // workflowCtx is shared across all steps (including sub-branches).
    // Pre-populate with any existing workflow context so chained workflow calls
    // can read results from prior top-level steps.
    const existing = getGlobalVariableStore().getState().getFullState()['context.workflow'];
    const workflowCtx: WorkflowCtx = typeof existing === 'object' && existing !== null
      ? { ...(existing as WorkflowCtx) }
      : {};

    // Resolve global workflow parameters from the caller's payload.
    // Each value may be a plain value or a formula string — evaluate formulas
    // in the calling context so parameters['name'] resolves to the real value.
    //
    // Param values reach us as strings (the runProjectWorkflow step converts
    // both `{ "formula": "..." }` objects and plain strings to a bare string).
    // To tell them apart we try evaluating; if the evaluator returns an error
    // (ReferenceError, SyntaxError, etc.) the string is a literal, not a
    // formula, so we keep the original string value.
    const resolveParamValue = (v: unknown, callingCtx: Record<string, unknown>): unknown => {
      if (typeof v !== 'string' || v.trim().length === 0) return v;
      try {
        const result = evaluateFormula(v, callingCtx);
        // Evaluator flagged the string as an invalid formula → treat as a
        // literal string value (e.g. "World", "Hi", "Ahmad").
        if (result.error != null) return v;
        return result.value;
      } catch {
        return v;
      }
    };

    let parameters: Record<string, unknown> | undefined;
    const rawParamsFromPayload = ctx.payload?.parameters as Record<string, unknown> | undefined;
    if (rawParamsFromPayload && Object.keys(rawParamsFromPayload).length > 0) {
      const vsState = getGlobalVariableStore().getState().getFullState();
      const callingCtx = buildFormulaCtx(vsState, ctx, undefined);
      parameters = Object.fromEntries(
        Object.entries(rawParamsFromPayload).map(([k, v]) => [k, resolveParamValue(v, callingCtx)])
      );
      if (typeof window !== 'undefined') {
        console.log('[workflow-steps-handler] resolved payload parameters:', {
          action: (actionDef as Record<string, unknown>).name ?? (actionDef as Record<string, unknown>).id,
          raw: rawParamsFromPayload,
          resolved: parameters,
        });
      }
    }
    // Also check the params defined on the actionDef itself (for JSON config usage).
    // Skip if params is an Array — that's parameter METADATA (e.g. [{id,name,testValue}])
    // from the workflow definition, not actual caller-supplied values.
    const rawParamsFromDef = (actionDef as Record<string, unknown>).params as Record<string, unknown> | undefined;
    if (rawParamsFromDef && !Array.isArray(rawParamsFromDef) && !parameters) {
      const vsState = getGlobalVariableStore().getState().getFullState();
      const callingCtx = buildFormulaCtx(vsState, ctx, undefined);
      parameters = Object.fromEntries(
        Object.entries(rawParamsFromDef).map(([k, v]) => [k, resolveParamValue(v, callingCtx)])
      );
    }

    const ctxWithParams = parameters
      ? { ...ctx, scope: { ...(ctx.scope ?? {}), parameters } }
      : ctx;

    // Write parameters into the variable store so every formula evaluator
    // (setVarHandler, graphql variables, etc.) sees them naturally via vsData.
    const prevParameters = parameters
      ? getGlobalVariableStore().getState().getFullState()['parameters']
      : undefined;
    if (parameters) {
      getGlobalVariableStore().getState().setState(prev =>
        setNestedValue(prev, 'parameters', parameters)
      );
    }

    try {
      const autoReturn = await runSteps(steps, ctxWithParams, workflowCtx, parameters);
      // Auto-forward the last step result to the caller — no explicit returnValue needed.
      // context.workflow['<runProjectWorkflow-step-id>'].result will carry it.
      if (autoReturn != null) ctx.setStepResult?.(autoReturn);
    } catch (e) {
      if (e instanceof ReturnValueSignal) {
        // Explicit returnValue step — takes priority; forward its specific value.
        ctx.setStepResult?.(e.value);
        return;
      }
      throw e;
    } finally {
      // Restore previous parameters so nested global workflow calls don't bleed.
      if (parameters) {
        getGlobalVariableStore().getState().setState(prev =>
          setNestedValue(prev, 'parameters', prevParameters ?? null)
        );
      }
    }
  };
