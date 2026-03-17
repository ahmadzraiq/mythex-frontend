/**
 * Action handler registry. Each handler is a curried function:
 * (ctx) => (actionDef) => Promise<void>
 *
 * To add a new action type: create a handler file and register it here.
 */

import type { ActionDef, ActionHandlerContext } from './types';
import { fetchHandler } from './fetch-handler';
import { graphqlHandler } from './graphql-handler';
import { setHandler } from './set-handler';
import { validateHandler } from './validate-handler';
import { incrementHandler, decrementHandler, toggleHandler, setVarHandler } from './variable-handlers';
import { appendToPathHandler } from './append-handler';
import { runMultipleHandler } from './run-multiple-handler';
import { navigateHandler } from './navigate-handler';
import { navigateWithQueryHandler } from './navigate-with-query-handler';
import { refetchDataSourceHandler } from './refetch-datasource-handler';
import { resetFormHandler, setFormStateHandler, submitFormHandler } from './form-variable-handler';
import {
  clearPersistedPathsHandler,
  goToPageHandler,
  removeAtHandler,
  setThemeHandler,
  setStateHandler,
  showToastHandler,
  cycleIndexHandler,
  mergeAtPathHandler,
} from './misc-handlers';
import { workflowStepsHandler } from './workflow-steps-handler';
import { openPopupHandler, closeAllPopupsHandler } from './popup-handlers';

type HandlerFactory = (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<unknown>;

export const ACTION_HANDLERS: Record<string, HandlerFactory> = {
  fetch: fetchHandler,
  graphql: graphqlHandler,
  set: setHandler,
  validate: validateHandler,
  increment: incrementHandler,
  decrement: decrementHandler,
  toggle: toggleHandler,
  setVar: setVarHandler,
  appendToPath: appendToPathHandler,
  runMultiple: runMultipleHandler,
  navigate: navigateHandler,
  navigateWithQuery: navigateWithQueryHandler,
  clearPersistedPaths: clearPersistedPathsHandler,
  goToPage: goToPageHandler,
  removeAt: removeAtHandler,
  setTheme: setThemeHandler,
  setState: setStateHandler,
  showToast: showToastHandler,
  cycleIndex: cycleIndexHandler,
  mergeAtPath: mergeAtPathHandler,
  refetchDataSource: refetchDataSourceHandler,
  resetForm: resetFormHandler,
  setFormState: setFormStateHandler,
  submitForm: submitFormHandler,
  // Visual workflow canvas step runner
  workflowSteps: workflowStepsHandler,
  // Popup actions
  openPopup: openPopupHandler,
  closeAllPopups: closeAllPopupsHandler,
};

/**
 * Dispatches an action to the registered handler if one exists.
 * Returns the handler's result, or `false` if no handler is registered.
 */
export async function dispatchToHandler(
  actionDef: ActionDef,
  ctx: ActionHandlerContext
): Promise<unknown> {
  if (!actionDef) return false;
  const type = actionDef.type;
  if (!type || typeof type !== 'string') return false;

  const factory = ACTION_HANDLERS[type];
  if (!factory) return false;

  return await factory(ctx)(actionDef);
}
