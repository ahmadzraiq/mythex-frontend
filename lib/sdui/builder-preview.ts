/**
 * Builder preview-state simulation.
 *
 * Extracted from sdui-engine.tsx — builder-only code that should not increase
 * bundle size or run in production paths.
 *
 * `applyPreviewStatePatch` is called by `applyBuilderPatches` in sdui-engine.tsx
 * which is now guarded by `builderMode` so this code is dead in production.
 */

import { setNestedValue } from './nested-utils';
import { mergeDataPaths } from './merge-state';
import type { SDUINode } from './types/node';

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
  if (previewState === 'validation') {
    let next = { ...merged };
    // Inject mock validation errors into every FormContainer's isolated variable store.
    // FormContainer stores field state at variables['${formId}-form'].fields.{name}.isValid.
    // We scan variables for any key ending in '-form' and inject errors into all
    // registered fields so inline error Text nodes (which check isValid) become visible.
    const variables = next.variables as Record<string, unknown> | undefined;
    if (variables && typeof variables === 'object') {
      const patchedVars: Record<string, unknown> = { ...variables };
      for (const key of Object.keys(variables)) {
        if (!key.endsWith('-form')) continue;
        const formStore = variables[key] as Record<string, unknown> | undefined;
        if (!formStore || typeof formStore !== 'object') continue;
        const fields = formStore.fields as Record<string, unknown> | undefined;
        if (!fields || typeof fields !== 'object') continue;
        const patchedFields: Record<string, unknown> = {};
        for (const fieldName of Object.keys(fields)) {
          const field = fields[fieldName] as Record<string, unknown> | undefined;
          patchedFields[fieldName] = {
            ...(typeof field === 'object' && field !== null ? field : {}),
            isValid: 'This field is required',
          };
        }
        patchedVars[key] = { ...formStore, fields: patchedFields };
      }
      next = { ...next, variables: patchedVars };
    }
    return next;
  }
  if (previewState === 'empty') {
    return deepClearArrays(merged) as Record<string, unknown>;
  }
  // custom states and 'disabled' — no global patch; handled per-node via applyStateTagOverrides
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

/**
 * Walk the node tree and apply show/hide overrides based on _stateTag annotations
 * and the currently active preview states.
 *
 * - 'loading' active: loading-tagged nodes → _forceShowInEditor:true; default/empty-tagged → condition:false
 * - 'empty'   active: empty-tagged nodes   → _forceShowInEditor:true; default/loading-tagged → condition:false
 * - 'disabled' active: nodes with props.disabled configured → _forceDisabledInEditor:true
 *
 * Returns the original array unchanged (no clone) when no overrides are needed (fast path).
 * This function is builder-only and never runs in production.
 */
export function applyStateTagOverrides(
  nodes: SDUINode[],
  activePreviewStates: string[]
): SDUINode[] {
  const loading  = activePreviewStates.includes('loading');
  const empty    = activePreviewStates.includes('empty');
  const disabled = activePreviewStates.includes('disabled');
  if (!loading && !empty && !disabled) return nodes; // fast path — no cloning

  function walk(node: SDUINode): SDUINode {
    const tag = (node as unknown as Record<string, unknown>)._stateTag as string | undefined;
    const hasDisabledProp =
      (node.props as Record<string, unknown> | undefined)?.disabled != null;

    let patched: SDUINode = node;

    // Loading state isolation: show loading nodes, hide default/empty nodes
    if (loading && tag) {
      if (tag === 'loading') {
        patched = { ...patched, _forceShowInEditor: true } as unknown as SDUINode;
      } else if (tag === 'default' || tag === 'empty') {
        patched = { ...patched, condition: false } as unknown as SDUINode;
      }
    }

    // Empty state isolation: show empty nodes, hide default/loading nodes
    if (empty && tag) {
      if (tag === 'empty') {
        patched = { ...patched, _forceShowInEditor: true } as unknown as SDUINode;
      } else if (tag === 'default' || tag === 'loading') {
        patched = { ...patched, condition: false } as unknown as SDUINode;
      }
    }

    // Disabled state: force the per-node overlay on nodes that have disabled configured
    if (disabled && hasDisabledProp) {
      patched = { ...patched, _forceDisabledInEditor: true } as unknown as SDUINode;
    }

    // Recurse into children
    if (patched.children?.length) {
      patched = { ...patched, children: patched.children.map(walk) };
    }
    return patched;
  }

  return nodes.map(walk);
}
