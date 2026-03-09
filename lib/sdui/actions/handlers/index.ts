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
import { appendHandler, appendToPathHandler } from './append-handler';
import { runMultipleHandler } from './run-multiple-handler';
import { navigateHandler } from './navigate-handler';
import { navigateWithQueryHandler } from './navigate-with-query-handler';
import { refetchDataSourceHandler } from './refetch-datasource-handler';
import { setFormFieldHandler, setFormStateHandler, resetFormHandler, submitFormHandler } from './form-variable-handler';
import {
  restoreHandler,
  clearPersistedPathsHandler,
  goToPageHandler,
  removeAtHandler,
  shareHandler,
  setThemeHandler,
  setStateHandler,
  showToastHandler,
  logHandler,
  cycleIndexHandler,
  mergeAtPathHandler,
} from './misc-handlers';
import { workflowStepsHandler } from './workflow-steps-handler';

type HandlerFactory = (ctx: ActionHandlerContext) => (actionDef: ActionDef) => Promise<void>;

export const ACTION_HANDLERS: Record<string, HandlerFactory> = {
  fetch: fetchHandler,
  graphql: graphqlHandler,
  set: setHandler,
  validate: validateHandler,
  increment: incrementHandler,
  decrement: decrementHandler,
  toggle: toggleHandler,
  setVar: setVarHandler,
  append: appendHandler,
  appendToPath: appendToPathHandler,
  runMultiple: runMultipleHandler,
  navigate: navigateHandler,
  navigateWithQuery: navigateWithQueryHandler,
  restore: restoreHandler,
  clearPersistedPaths: clearPersistedPathsHandler,
  goToPage: goToPageHandler,
  removeAt: removeAtHandler,
  share: shareHandler,
  setTheme: setThemeHandler,
  setState: setStateHandler,
  showToast: showToastHandler,
  log: logHandler,
  cycleIndex: cycleIndexHandler,
  mergeAtPath: mergeAtPathHandler,
  refetchDataSource: refetchDataSourceHandler,
  setFormField: setFormFieldHandler,
  setFormState: setFormStateHandler,
  resetForm: resetFormHandler,
  submitForm: submitFormHandler,
  // Visual workflow canvas step runner
  workflowSteps: workflowStepsHandler,
};

/**
 * Dispatches an action to the registered handler if one exists.
 * Returns true if handled, false if no handler registered.
 */
export async function dispatchToHandler(
  actionDef: ActionDef,
  ctx: ActionHandlerContext
): Promise<boolean> {
  const type = actionDef.type;
  if (!type || typeof type !== 'string') return false;

  const factory = ACTION_HANDLERS[type];
  if (!factory) return false;

  await factory(ctx)(actionDef);
  return true;
}
