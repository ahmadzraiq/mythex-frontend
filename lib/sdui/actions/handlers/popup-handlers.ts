/**
 * Popup action handlers.
 *
 * openPopupHandler  — opens a popup instance from config/popups.json.
 *   When waitClose=true it returns a Promise that resolves when the instance
 *   is closed; the resolved value is available as context.workflow[stepId].result
 *   in subsequent steps.
 *
 * closeAllPopupsHandler — closes every open popup instance.
 */

import type { ActionHandlerContext, ActionDef } from './types';
import { usePopupStore } from '../../popup-store';
import { evaluateFormula } from '../../formula-evaluator';
import popupsJson from '../../../../config/popups.json';
// Prefer live in-memory store (builder/preview dev mode) — falls back to static JSON.
// The @/ alias avoids fragile relative-path resolution across deep directories.
import { getPopups as getLivePopups } from '@/lib/builder/popup-data';

export interface PopupModel {
  id: string;
  name: string;
  type: 'Blank' | 'Modal' | 'Sheet' | 'Alert' | 'StackedAlert';
  allowStacking: boolean;
  properties: Array<{ id: string; name: string; type: string; defaultValue?: unknown }>;
  content: Record<string, unknown>;
}

const staticPopupModels = popupsJson as Record<string, PopupModel>;

/** Returns the most up-to-date popup models (live in-memory store in dev, static JSON in prod).
 *  For each model, falls back to the static JSON version if the live content looks empty/corrupt.
 */
function getPopupModels(): Record<string, PopupModel> {
  try {
    const live = getLivePopups() as Record<string, PopupModel>;
    if (live && Object.keys(live).length > 0) {
      // Merge live + static: prefer live model but fall back to static content when
      // the live version's content has no children (guards against corrupt builder saves).
      const merged: Record<string, PopupModel> = { ...staticPopupModels };
      for (const [id, liveModel] of Object.entries(live)) {
        const liveContent = liveModel.content as { children?: unknown[] } | undefined;
        const hasValidContent = liveContent && Array.isArray(liveContent.children) && liveContent.children.length > 0;
        if (hasValidContent) {
          merged[id] = liveModel;
        } else {
          // Use static model content if live content is empty/corrupt; preserve live metadata
          const staticModel = staticPopupModels[id];
          merged[id] = staticModel
            ? { ...liveModel, content: staticModel.content }
            : liveModel;
        }
      }
      return merged;
    }
  } catch { /* not available */ }
  return staticPopupModels;
}

export const openPopupHandler =
  (ctx: ActionHandlerContext) =>
  async (actionDef: ActionDef): Promise<unknown> => {
    const modelId = actionDef.popupId as string | undefined;
    const propsRaw = (actionDef.props ?? {}) as Record<string, unknown>;
    const waitClose = Boolean(actionDef.waitClose);

    if (!modelId) {
      console.warn('[openPopup] No popupId specified');
      return;
    }

    const popupModels = getPopupModels();
    const model = popupModels[modelId];
    if (!model) {
      console.warn('[openPopup] Popup model not found:', modelId);
      return;
    }

    // Resolve formula values in props against the current state.
    // The workflow config stores props keyed by property UUID. Values may be:
    //  - a plain string (literal value)
    //  - a FormulaValue object { formula: "expression" } (bound formula)
    const state = ctx.getFullMergedState();
    const resolvedProps: Record<string, unknown> = {};
    for (const [propId, rawVal] of Object.entries(propsRaw)) {
      if (rawVal && typeof rawVal === 'object' && 'formula' in (rawVal as object)) {
        const formula = (rawVal as { formula: string }).formula;
        resolvedProps[propId] = evaluateFormula(formula, state).value ?? '';
      } else {
        resolvedProps[propId] = rawVal;
      }
    }

    // Fill in missing props with property defaultValues from the model
    for (const prop of model.properties) {
      if (!(prop.id in resolvedProps)) {
        resolvedProps[prop.id] = prop.defaultValue ?? '';
      }
    }

    const store = usePopupStore.getState();

    // If stacking is not allowed, close any existing instances of this model first
    if (!model.allowStacking) {
      store.closeByModelId(modelId);
    }

    if (waitClose) {
      return new Promise<unknown>((resolve) => {
        store.openInstance(modelId, resolvedProps, true, resolve);
      });
    }

    store.openInstance(modelId, resolvedProps, false);
  };

export const closeAllPopupsHandler =
  (_ctx: ActionHandlerContext) =>
  async (_actionDef: ActionDef): Promise<void> => {
    usePopupStore.getState().closeAllPopups();
  };
