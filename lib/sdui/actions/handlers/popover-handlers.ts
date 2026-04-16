/**
 * Action handlers for opening, closing, and toggling popovers.
 * These write to the global variable store at `_popover.popover.{nodeId}`
 * (or the user's custom `openVariable` path).
 */

import type { ActionDef, ActionHandlerContext } from './types';
import { getGlobalVariableStore } from '../../global-variable-store';

function resolveStorePath(actionDef: ActionDef): string {
  const nodeId = actionDef.nodeId as string | undefined;
  const field = (actionDef.field as string) || 'popover';
  if (!nodeId) return '';
  return `_popover.${field}.${nodeId}`;
}

export const openPopoverHandler = (_ctx: ActionHandlerContext) => async (actionDef: ActionDef) => {
  const path = resolveStorePath(actionDef);
  if (!path) return;
  getGlobalVariableStore().getState().set(path, true);
};

export const closePopoverHandler = (_ctx: ActionHandlerContext) => async (actionDef: ActionDef) => {
  const path = resolveStorePath(actionDef);
  if (!path) return;
  getGlobalVariableStore().getState().set(path, false);
};

export const togglePopoverHandler = (_ctx: ActionHandlerContext) => async (actionDef: ActionDef) => {
  const path = resolveStorePath(actionDef);
  if (!path) return;
  const store = getGlobalVariableStore().getState();
  const current = store.get(path);
  store.set(path, !current);
};
