/**
 * Builder preview-state simulation.
 *
 * Extracted from sdui-engine.tsx — builder-only code that should not increase
 * bundle size or run in production paths.
 *
 * `applyPreviewStatePatch` is called by `applyBuilderPatches` in sdui-engine.tsx
 * which is now guarded by `builderMode` so this code is dead in production.
 */

import { getNestedValue, setNestedValue } from './nested-utils';
import { mergeDataPaths } from './merge-state';

/** Recursively replace all arrays in a value with empty arrays. */
function deepClearArrays(val: unknown): unknown {
  if (Array.isArray(val)) return [];
  if (val && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, deepClearArrays(v)])
    );
  }
  return val;
}

/** Apply a preview-state patch on top of the merged state for builder simulation. */
export function applyPreviewStatePatch(
  merged: Record<string, unknown>,
  previewState: string,
  configName: string,
  loadingSuffix: string | undefined
): Record<string, unknown> {
  if (previewState === 'normal' || !previewState) return merged;
  if (previewState === 'loading') {
    let next = { ...merged };
    next = setNestedValue(next, '_workflow.loading', true);
    if (loadingSuffix) {
      for (const key of Object.keys(merged)) {
        if (key.startsWith('_') || typeof merged[key] !== 'object') continue;
        next = setNestedValue(next, `${key}.${loadingSuffix}`, true);
      }
    }
    return next;
  }
  if (previewState === 'error') {
    let next = setNestedValue(
      setNestedValue({ ...merged }, '_workflow.lastError', 'Preview error'),
      '_workflow.lastAction', 'preview'
    );
    if (configName) {
      const screenForm = (getNestedValue(merged, `screens.${configName}.form`) ??
        getNestedValue(merged, 'form')) as Record<string, unknown> | undefined;
      if (screenForm && typeof screenForm === 'object') {
        for (const field of Object.keys(screenForm)) {
          if (typeof (screenForm as Record<string, unknown>)[field] !== 'object') {
            next = setNestedValue(next, `screens.${configName}.errors.form.${field}`, 'Preview error');
          }
        }
      }
      const screenErrors = (getNestedValue(merged, `screens.${configName}.errors`) ??
        getNestedValue(merged, 'errors')) as Record<string, unknown> | undefined;
      if (screenErrors && typeof screenErrors === 'object') {
        for (const field of Object.keys(screenErrors)) {
          next = setNestedValue(next, `screens.${configName}.errors.${field}`, 'Preview error');
        }
      }
    }
    return next;
  }
  if (previewState === 'validation') {
    let next = { ...merged };
    if (configName) {
      const screenForm = (getNestedValue(merged, `screens.${configName}.form`) ??
        getNestedValue(merged, 'form')) as Record<string, unknown> | undefined;
      if (screenForm && typeof screenForm === 'object') {
        for (const field of Object.keys(screenForm)) {
          if (typeof (screenForm as Record<string, unknown>)[field] !== 'object') {
            next = setNestedValue(next, `screens.${configName}.errors.form.${field}`, 'This field is required');
          }
        }
      }
    }
    return next;
  }
  if (previewState === 'empty') {
    return deepClearArrays(merged) as Record<string, unknown>;
  }
  if (previewState === 'disabled') {
    return setNestedValue({ ...merged }, '_preview_disabled', true);
  }
  // custom states — no global patch; _stateOverrides handled per-node in renderer
  return merged;
}

/** Apply preview data overlay on top of merged state. */
export function applyPreviewDataPatch(
  merged: Record<string, unknown>,
  previewData: Record<string, unknown>
): Record<string, unknown> {
  if (!previewData || Object.keys(previewData).length === 0) return merged;
  return mergeDataPaths(merged, previewData);
}
