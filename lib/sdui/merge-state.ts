/**
 * Merge state helpers - split from computeMergedState for readability
 */

import { setNestedValue } from './nested-utils';
import { runComputed } from './computed-runner';
import { CONVENTIONS } from './conventions';

type StoreState = {
  data: Record<string, unknown>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
};

type ComputedDef = { output: string; expr: object };

/**
 * Merge config meta into the base merged object.
 *
 * NOTE: config.state (screen-level state) is intentionally NOT spread here.
 * All mutable state must be declared in config/variables.json and accessed via
 * variables['UUID']. Spreading screen state as flat top-level keys allowed bare
 * paths (e.g. "animShowExit") to silently resolve without a declaration — that
 * pattern is forbidden. Screen state is still written to the variable store at
 * screens.{configName}.* via the engine's useEffect, but nothing should read
 * from those paths directly.
 */
export function mergeConfigState(
  _merged: Record<string, unknown>,
  _configState: Record<string, unknown> | undefined,
  meta: Record<string, unknown> | undefined
): Record<string, unknown> {
  return {
    ...(meta ? { meta } : {}),
  } as Record<string, unknown>;
}

/** Merge data paths from Zustand store into merged state */
export function mergeDataPaths(
  merged: Record<string, unknown>,
  data: Record<string, unknown>
): Record<string, unknown> {
  const dataPaths = Object.keys(data).sort((a, b) => a.split('.').length - b.split('.').length);
  let next = merged;
  for (const path of dataPaths) {
    next = setNestedValue(next, path, data[path]);
  }
  return next;
}

/** Merge loading paths - add loadingSuffix to each slice */
export function mergeLoadingPaths(
  merged: Record<string, unknown>,
  loading: Record<string, boolean>
): Record<string, unknown> {
  const suffix = CONVENTIONS.loadingSuffix;
  let next = merged;
  for (const path of Object.keys(loading)) {
    const slice = path.split('.')[0];
    next = setNestedValue(next, `${slice}.${suffix}`, loading[path]);
  }
  return next;
}

/** Merge error paths - add errorSuffix to each slice */
export function mergeErrorPaths(
  merged: Record<string, unknown>,
  error: Record<string, string | null>
): Record<string, unknown> {
  const suffix = CONVENTIONS.errorSuffix;
  let next = merged;
  for (const path of Object.keys(error)) {
    const slice = path.split('.')[0];
    next = setNestedValue(next, `${slice}.${suffix}`, error[path]);
  }
  return next;
}

/** Apply computed definitions to merged state */
export function applyComputed(
  merged: Record<string, unknown>,
  computedDefs: ComputedDef[]
): Record<string, unknown> {
  if (computedDefs.length === 0) return merged;
  return runComputed(merged, computedDefs, {});
}

/**
 * Overlays variable store onto merged state, then runs any computed defs.
 */
export function finalizeMergedWithVariableStore(
  merged: Record<string, unknown>,
  vs: Record<string, unknown>,
  computedDefs: ComputedDef[] = []
): Record<string, unknown> {
  let next: Record<string, unknown> = { ...merged };
  for (const [key, val] of Object.entries(vs)) {
    const mVal = merged[key];
    if (
      val !== null && typeof val === 'object' && !Array.isArray(val) &&
      mVal !== null && typeof mVal === 'object' && !Array.isArray(mVal)
    ) {
      next[key] = { ...(mVal as object), ...(val as object) };
    } else if (val !== undefined) {
      next[key] = val;
    }
  }
  if (computedDefs.length > 0) {
    next = runComputed(next, computedDefs as Parameters<typeof runComputed>[1], {});
  }

  // Inject `variables` namespace: the whole variable store so `variables['UUID']` works.
  next['variables'] = vs;

  return next;
}

/** Full computeMergedState - combines all merge steps */
export function computeMergedState(
  state: StoreState,
  config: { state?: Record<string, unknown>; meta?: Record<string, unknown> },
  computedDefs: ComputedDef[]
): Record<string, unknown> {
  const meta = config.meta;
  let merged = mergeConfigState({}, config.state, meta);
  merged = mergeDataPaths(merged, state.data);
  merged = mergeLoadingPaths(merged, state.loading);
  merged = mergeErrorPaths(merged, state.error);
  merged = applyComputed(merged, computedDefs);

  // `collections` namespace is already built by mergeDataPaths:
  // setData("collections.UUID", data) → setNestedValue creates merged.collections[UUID] = data.
  // We only need to ensure the key exists; never overwrite what mergeDataPaths already built.
  // Enables `collections['UUID']?.field` and `{{collections.UUID.field}}` syntax.
  if (!merged['collections'] || typeof merged['collections'] !== 'object') {
    merged['collections'] = {};
  }

  return merged;
}
