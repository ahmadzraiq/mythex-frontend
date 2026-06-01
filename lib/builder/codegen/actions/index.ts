/**
 * Action dispatcher — routes a workflow step to its emitter.
 * Returns the JS source string for that step.
 */

import type { SymbolMap } from '../types';
import { emitSet } from './set';
import { emitSetVar } from './set-var';
import { emitMergeAtPath } from './merge-at-path';
import { emitAppendToPath } from './append-to-path';
import { emitRemoveAt } from './remove-at';
import { emitToggle } from './toggle';
import { emitIncrement } from './increment';
import { emitCycleIndex } from './cycle-index';
import { emitNavigate } from './navigate';
import { emitShowToast } from './show-toast';
import { emitFetch } from './fetch';
import { emitGraphQL } from './graphql';
import { emitRefetch } from './refetch';
import { emitFormAction } from './form';
import { emitPopover } from './popover';
import { emitSetTheme } from './set-theme';
import { emitClearPersisted } from './clear-persisted';
import { emitSharedComponent } from './shared-component';
import { emitClearSession } from './clear-session';
import {
  emitNavigateTo,
  emitChangeVariableValue,
  emitFetchCollection,
  emitRunJavaScript,
  emitBranch,
  emitForEach,
  emitRunProjectWorkflow,
  emitTimeDelay,
  emitScrollToElement,
  emitAnimateStep,
  emitExecuteComponentAction,
  emitNavigatePrev,
  emitReturnValue,
  emitBreakLoop,
  emitContinueLoop,
  emitWhileLoop,
  emitMultiOptionBranch,
  emitPassThrough,
  emitResetVariableValue,
  emitFetchData,
  emitFetchCollectionsParallel,
  emitUpdateCollection,
  emitAuthenticate,
  emitRestoreSession,
  emitSetUser,
  emitStopPropagation,
  emitCopyToClipboard,
  emitDownloadFile,
  emitPrintPdf,
  emitPickFile,
  emitEncodeBase64,
  emitCreateUrlFromBase64,
  emitPageLoader,
  emitOpenPopup,
  emitCloseAllPopups,
  emitEmitComponentTrigger,
  emitChangeLanguage,
  emitCustomJavaScript,
} from './misc';

export function emitStep(step: Record<string, unknown>, symbols: SymbolMap, inMapScope = false, stepId?: string): string {
  const type = step.type as string;

  switch (type) {
    case 'set':
    case 'setState':
      return emitSet(step as never, symbols);
    case 'setVar':
      return emitSetVar(step as never, symbols);
    case 'mergeAtPath':
      return emitMergeAtPath(step as never, symbols, inMapScope);
    case 'appendToPath':
      return emitAppendToPath(step as never, symbols);
    case 'removeAt':
      return emitRemoveAt(step as never, symbols);
    case 'toggle':
      return emitToggle(step as never);
    case 'increment':
    case 'decrement':
      return emitIncrement(step as never, symbols);
    case 'cycleIndex':
      return emitCycleIndex(step as never, symbols);
    case 'navigate':
    case 'navigateWithQuery':
    case 'goToPage':
      return emitNavigate(step as never, symbols);
    case 'showToast':
      return emitShowToast(step as never, symbols);
    case 'fetch':
      return emitFetch(step as never, symbols, stepId);
    case 'graphql':
      return emitGraphQL(step as never, symbols, stepId);
    case 'refetchDataSource':
      return emitRefetch(step as never, symbols);
    case 'validate':
    case 'resetForm':
    case 'setFormState':
    case 'submitForm':
      return emitFormAction(step as never, symbols);
    case 'openPopover':
    case 'closePopover':
    case 'togglePopover':
      return emitPopover(step as never);
    case 'setTheme':
      return emitSetTheme(step as never, symbols);
    case 'clearPersistedPaths':
      return emitClearPersisted(step as never, symbols);
    case 'clearSession':
      return emitClearSession();

    // ── Aliases and extended action types ────────────────────────────────────
    case 'navigateTo':
      return emitNavigateTo(step as never, symbols);
    case 'changeVariableValue':
      return emitChangeVariableValue(step as never, symbols);
    case 'fetchCollection':
      return emitFetchCollection(step as never, symbols);
    case 'runJavaScript':
      return emitRunJavaScript(step as never, symbols);
    case 'branch':
      return emitBranch(step as never, symbols);
    case 'forEach':
      return emitForEach(step as never, symbols);
    case 'runProjectWorkflow':
      return emitRunProjectWorkflow(step as never, symbols);
    case 'timeDelay':
      return emitTimeDelay(step as never);
    case 'scrollToElement':
      return emitScrollToElement(step as never);
    case 'animate':
    case 'triggerExitAnimation':
    case 'startLoop':
    case 'stopLoop':
    case 'playEnterAnimation':
      return emitAnimateStep(step as never);
    case 'executeComponentAction':
      return emitExecuteComponentAction(step as never, symbols);

    // ── Navigation ────────────────────────────────────────────────────────────
    case 'navigatePrev':
    case 'navigateBack':
      return emitNavigatePrev(step);

    // ── Control flow ──────────────────────────────────────────────────────────
    case 'returnValue':
      return emitReturnValue(step, symbols);
    case 'breakLoop':
      return emitBreakLoop();
    case 'continueLoop':
      return emitContinueLoop();
    case 'whileLoop':
      return emitWhileLoop(step, symbols);
    case 'multiOptionBranch':
      return emitMultiOptionBranch(step, symbols);
    case 'passThroughCondition':
      return emitPassThrough(step, symbols);

    // ── State ─────────────────────────────────────────────────────────────────
    case 'resetVariableValue':
      return emitResetVariableValue(step, symbols);

    // ── Data fetching ─────────────────────────────────────────────────────────
    case 'fetchData':
      return emitFetchData(step, symbols);
    case 'fetchCollectionsParallel':
      return emitFetchCollectionsParallel(step, symbols);
    case 'updateCollection':
      return emitUpdateCollection(step, symbols);

    // ── Auth ──────────────────────────────────────────────────────────────────
    case 'authenticate':
      return emitAuthenticate(step, symbols);
    case 'restoreSession':
      return emitRestoreSession();
    case 'setUser':
      return emitSetUser(step, symbols);

    // ── DOM / Browser ─────────────────────────────────────────────────────────
    case 'stopPropagation':
      return emitStopPropagation();
    case 'copyToClipboard':
      return emitCopyToClipboard(step, symbols);
    case 'downloadFileFromUrl':
    case 'downloadFile':
      return emitDownloadFile(step, symbols);
    case 'printPdf':
      return emitPrintPdf();
    case 'pickFile':
      return emitPickFile(step, symbols);
    case 'encodeFileAsBase64':
      return emitEncodeBase64(step, symbols);
    case 'createUrlFromBase64':
      return emitCreateUrlFromBase64(step, symbols);
    case 'pageLoader':
      return emitPageLoader(step);
    case 'openPopup':
      return emitOpenPopup(step);
    case 'closeAllPopups':
    case 'closePopups':
      return emitCloseAllPopups();
    case 'emitComponentTrigger':
      return emitEmitComponentTrigger(step, symbols);
    case 'changeLanguage':
      return emitChangeLanguage(step);
    case 'customJavaScript':
      return emitCustomJavaScript(step, symbols);

    case 'addSharedComponent':
    case 'deleteSharedComponent':
    case 'deleteAllSharedComponents':
      return emitSharedComponent(step as never, symbols);
    case 'runMultiple': {
      // Defer to avoid circular — inline implementation
      const subSteps = (step.actions ?? step.steps ?? []) as Record<string, unknown>[];
      return subSteps.map(s => emitStep(s, symbols)).join('\n');
    }
    case 'workflowSteps': {
      const subSteps = (step.steps ?? []) as Record<string, unknown>[];
      return subSteps.map(s => emitStep(s, symbols)).join('\n');
    }
    default:
      // A step with `action` and no `type` is a workflow-reference call
      if (step.action && typeof step.action === 'string') {
        const wfName = symbols.workflows.get(step.action);
        if (wfName) return `await ${wfName}(ctx);`;
        return `/* workflow call: ${step.action} */`;
      }
      // Unknown action type — emit a comment so the export never fails.
      // The type name is preserved so developers can implement a handler later.
      return `/* unhandled action type: ${type ?? JSON.stringify(step)} */`;
  }
}
