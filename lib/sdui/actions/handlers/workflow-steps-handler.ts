/**
 * workflowSteps handler — executes an ActionStep[] array from the visual workflow builder.
 *
 * Maps each ActionStepType from the canvas to an equivalent SDUI inline action
 * and dispatches it through the existing runOne pipeline, so all registered
 * handlers (graphql, fetch, navigate, validate, submitForm, etc.) continue to work.
 *
 * Usage in JSON:
 *   "actions": { "click": { "type": "workflowSteps", "steps": [ ... ] } }
 *
 * Each step:
 *   { "id": "...", "type": "ActionStepType", "config": { ...actionParams } }
 */

import type { ActionHandlerContext, ActionDef } from './types';

interface WorkflowStep {
  id: string;
  type: string;
  name?: string;
  disabled?: boolean;
  config?: Record<string, unknown>;
  trueBranch?: WorkflowStep[];
  falseBranch?: WorkflowStep[];
  branches?: { label: string; steps: WorkflowStep[] }[];
  loopBody?: WorkflowStep[];
}

/** Convert a canvas ActionStep into an inline SDUI action definition. */
function stepToSdui(step: WorkflowStep): Record<string, unknown> | null {
  const cfg = step.config ?? {};

  switch (step.type) {
    // ── Navigation ──────────────────────────────────────────────────────────
    case 'navigate':
      return { type: 'navigate', ...cfg };
    case 'navigateTo':
      // Visual builder's navigation step: supports both plain paths and queryParams
      if (cfg.queryParams) {
        return { type: 'navigateWithQuery', path: cfg.path, queryParams: cfg.queryParams, replace: cfg.replace };
      }
      return { action: 'navigate', payload: { path: cfg.path, routeConfig: cfg.routeConfig } };
    case 'navigatePrev':
    case 'navigatePreviousPage':
      return null; // handled by navigatePreviousPage case below (window.history.back)
    case 'pageLoader':
      return { type: 'navigate', ...cfg };

    // ── Data / API ───────────────────────────────────────────────────────────
    case 'graphql':
      return { type: 'graphql', ...cfg };
    case 'fetchData':
      return { type: 'fetch', ...cfg };
    case 'fetchCollection':
      // Visual builder's fetchCollection step: calls a named action
      return { action: (cfg.collectionName ?? cfg.name ?? '') as string };
    case 'updateCollection':
      return { type: 'refetchDataSource', ...cfg };

    // ── Variables ────────────────────────────────────────────────────────────
    case 'changeVariableValue':
      // Visual builder's primary variable-change step
      return { type: 'setVar', path: (cfg.variableName ?? cfg.variable) as string, value: cfg.value };
    case 'changeVariable':
      // Legacy alias
      if (cfg.path !== undefined) {
        return { type: 'setState', payload: { path: cfg.path, value: cfg.value } };
      }
      return { type: 'set', path: cfg.path, value: cfg.value };
    case 'resetVariableValue':
    case 'resetVariable':
      return { type: 'setVar', path: (cfg.variableName ?? cfg.path) as string, value: cfg.defaultValue ?? null };

    // ── Project workflow reference (legacy builder format) ───────────────────
    case 'runProjectWorkflow':
      return { action: (cfg.workflowId ?? cfg.workflowName ?? step.action ?? '') as string };

    // ── Forms ────────────────────────────────────────────────────────────────
    case 'validateForm':
      return { type: 'validate', ...cfg };
    case 'submitForm':
      return { type: 'submitForm', ...cfg };

    // ── Workflow control ─────────────────────────────────────────────────────
    case 'executeWorkflow':
      return { action: (cfg.workflowId ?? cfg.workflowName ?? '') as string, payload: cfg.params as Record<string, unknown> };
    case 'returnValue':
      // Store return value at a configurable path
      return cfg.path ? { type: 'set', path: cfg.path, value: cfg.value } : null;

    // ── UI ───────────────────────────────────────────────────────────────────
    case 'showToast':
      return { type: 'showToast', ...cfg };
    case 'openPopup':
      return { type: 'openPopup', ...cfg };
    case 'closeAllPopups':
      return { type: 'closeAllPopups' };

    // ── Misc ─────────────────────────────────────────────────────────────────
    case 'stopPropagation':
      // Propagation stopping happens at the DOM event level; no-op here
      return null;
    case 'printPdf':
      return { type: '__printPdf' };
    case 'copyToClipboard':
      return { type: '__copyToClipboard', value: cfg.value };
    case 'downloadCsv':
      return { type: '__downloadCsv', ...cfg };
    case 'encodeFileAsBase64':
      return { type: '__encodeBase64', ...cfg };
    case 'createUrlFromBase64':
      return { type: '__createUrlFromBase64', ...cfg };
    case 'uploadFile':
      return { type: '__uploadFile', ...cfg };

    // ── Already valid SDUI types (pass config directly as action properties) ────
    case 'set':
    case 'setState':
    case 'setVar':
    case 'increment':
    case 'decrement':
    case 'toggle':
    case 'runMultiple':
    case 'fetch':
    case 'append':
    case 'appendToPath':
    case 'removeAt':
    case 'showToast' as string:
    case 'log':
    case 'cycleIndex':
    case 'mergeAtPath':
    case 'goToPage':
    case 'navigateWithQuery':
    case 'share':
    case 'restore':
    case 'setTheme':
    case 'setFormField':
    case 'clearPersistedPaths':
    case 'validate':
    case 'submitForm':
    case 'graphql' as string:
    case 'refetchDataSource':
      return { type: step.type, ...cfg };

    // ── Skip structural / utility placeholders ───────────────────────────────
    case 'branch':
    case 'multiOptionBranch':
    case 'forEach':
    case 'whileLoop':
    case 'breakLoop':
    case 'continueLoop':
    case 'passThroughCondition':
    case 'unconfigured':
      return null; // handled structurally in the runner below

    default:
      // Unknown type — forward as inline action; engine will ignore if no handler
      return { type: step.type, ...cfg };
  }
}

/** Recursively execute a list of workflow steps. */
async function runSteps(
  steps: WorkflowStep[],
  ctx: ActionHandlerContext,
): Promise<void> {
  for (const step of steps) {
    if (step.disabled) continue;

    // ── Structural: True/False branch ────────────────────────────────────────
    if (step.type === 'branch') {
      // Evaluate condition via get(); falsy = false branch
      const condPath = (step.config?.conditionPath as string) ?? '';
      const condResult = condPath ? ctx.get(condPath) : false;
      const branch = condResult ? (step.trueBranch ?? []) : (step.falseBranch ?? []);
      await runSteps(branch, ctx);
      continue;
    }

    // ── Structural: Multi-option branch ──────────────────────────────────────
    if (step.type === 'multiOptionBranch') {
      const condPath = (step.config?.conditionPath as string) ?? '';
      const condValue = condPath ? String(ctx.get(condPath)) : '';
      const matchedBranch = (step.branches ?? []).find(b => b.label === condValue);
      if (matchedBranch) {
        await runSteps(matchedBranch.steps, ctx);
      }
      continue;
    }

    // ── Structural: For-each loop ─────────────────────────────────────────────
    if (step.type === 'forEach') {
      const itemsPath = (step.config?.itemsPath as string) ?? '';
      const items = itemsPath ? (ctx.get(itemsPath) as unknown[]) : [];
      if (Array.isArray(items)) {
        for (const _item of items) {
          await runSteps(step.loopBody ?? [], ctx);
        }
      }
      continue;
    }

    // ── Structural: While loop ────────────────────────────────────────────────
    if (step.type === 'whileLoop') {
      const condPath = (step.config?.conditionPath as string) ?? '';
      let guard = 0; // safety limit
      while (condPath && ctx.get(condPath) && guard < 100) {
        await runSteps(step.loopBody ?? [], ctx);
        guard++;
      }
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
      if (typeof window !== 'undefined') window.history.back();
      continue;
    }

    if (step.type === 'printPdf') {
      if (typeof window !== 'undefined') window.print();
      continue;
    }

    // ── Raw ActionRef (serialized runNamedAction: { action: "name" }) ─────────
    if (!step.type && (step as unknown as Record<string, unknown>).action) {
      await ctx.runOne(step as unknown as import('../../types').SDUIAction);
      continue;
    }

    // ── Dispatch to existing SDUI handler ─────────────────────────────────────
    const sduiDef = stepToSdui(step);
    if (sduiDef) {
      await ctx.runOne(sduiDef as import('../../types').SDUIAction);
    }
  }
}

export const workflowStepsHandler =
  (ctx: ActionHandlerContext) =>
  async (actionDef: ActionDef): Promise<void> => {
    const steps = (actionDef.steps ?? []) as WorkflowStep[];
    await runSteps(steps, ctx);
  };
