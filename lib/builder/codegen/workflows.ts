/**
 * workflows.ts — Emit action functions split into domain files.
 *
 * Each source config file (auth, cart, product, layout, …) produces one
 * `lib/actions/<name>.ts` file.  A barrel `lib/actions/index.ts` re-exports
 * everything so existing callers only need to update their import path.
 *
 * Each generated function looks like:
 *
 *   export async function signIn(ctx: ActionCtx): Promise<void> {
 *     const { router, form, event } = ctx;
 *     const wwLib = createActionCtx(ctx);   // shared utilities, defined once
 *     const _formData: any = form?.watch?.() ?? {};
 *     const _results: Record<string, { result?: unknown }> = {};
 *     const context = { ...(ctx.context ?? {}), workflow: _results, event };
 *     void context;
 *     // ... actual steps ...
 *   }
 */

import type { CodegenCtx, EmittedFile } from './types';
import type { BuilderStore } from '../_store-types';
import { emitStep } from './actions/index';

/** Walk the store's page nodes to find a node by id */
function findNodeById(store: BuilderStore, id: string): Record<string, unknown> | null {
  function walk(nodes: unknown[]): Record<string, unknown> | null {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;
      if (n.id === id) return n;
      const children = (n.children ?? []) as unknown[];
      const found = walk(children);
      if (found) return found;
    }
    return null;
  }
  for (const page of (store.pages ?? []) as Array<Record<string, unknown>>) {
    const found = walk((page.nodes ?? []) as unknown[]);
    if (found) return found;
  }
  return null;
}

/** Emit one action function body given its id and steps array. */
function emitActionFunction(
  id: string,
  steps: object[],
  ctx: CodegenCtx,
): string {
  const { store, symbols } = ctx;
  const fnName = symbols.workflows.get(id) ?? id;

  const lines: string[] = [];
  lines.push(`export async function ${fnName}(ctx: ActionCtx): Promise<void> {`);
  // state is used by formula rewrites (state.variables.xxx, state.collections.xxx, etc.)
  // Fall back to live store snapshot so the function also works when called without ctx.state.
  lines.push(`  const state = ctx.state ?? useStore.getState();`);
  lines.push(`  void state;`);
  lines.push(`  const { router, form, event } = ctx;`);
  // api is used by datasource fetch helpers (api.collectionName())
  lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`  const api: Record<string, (...args: any[]) => Promise<any>> = ctx.api ?? {};`);
  lines.push(`  void router; void api;`);
  // wwLib provides all builder engine API calls (navigate, variables, popovers, auth, …).
  // It uses the per-call ctx so the correct router/form/popover are always in scope.
  lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`  const wwLib = createActionCtx(ctx);`);
  lines.push(`  void wwLib;`);
  // _formData gives formula expressions access to React Hook Form field values.
  lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`  const _formData: any = form?.watch?.() ?? {};`);
  lines.push(`  void _formData;`);
  // _globalCtx mirrors the builder engine's global context object.
  // Formulas that reference _globalCtx.browser.query.xxx read current URL search params.
  lines.push(`  const _globalCtx = { browser: { query: typeof window !== 'undefined' ? Object.fromEntries(new URLSearchParams(window.location.search).entries()) : {} } };`);
  lines.push(`  void _globalCtx;`);
  // _results + context mirror the builder engine's context.workflow.<stepId>.result pattern
  // so that multi-step formulas that reference prior step results continue to work.
  lines.push(`  const _results: Record<string, { result?: unknown }> = {};`);
  lines.push(`  const context = { ...(ctx.context ?? {}), workflow: _results, event };`);
  lines.push(`  void context;`);
  lines.push('');

  try {
    for (let step of steps as Record<string, unknown>[]) {
      // Pre-process triggerExitAnimation: resolve the target node's exit animation config.
      if (step.type === 'triggerExitAnimation') {
        const cfg = (step.config ?? {}) as Record<string, unknown>;
        if (!cfg.animation) {
          const targetId = cfg.targetNodeId as string | undefined;
          if (targetId) {
            const found = findNodeById(store, targetId);
            const exitAnim = (found as Record<string, unknown> | null)?.animation as Record<string, unknown> | undefined
                          ?? (found as Record<string, unknown> | null)?.props as Record<string, unknown> | undefined;
            const exitCfg = (exitAnim?.exit ?? (exitAnim as Record<string, unknown> | undefined)?.animation?.exit) as Record<string, unknown> | undefined;
            if (exitCfg?.type) {
              step = { ...step, config: { ...cfg, animation: exitCfg.type, duration: exitCfg.duration ?? cfg.duration ?? 300 } };
            } else {
              step = { ...step, config: { ...cfg, animation: 'fadeOut', duration: cfg.duration ?? 300 } };
            }
          }
        }
      }

      const stepId = step.id as string | undefined;
      const stepType = step.type as string | undefined;
      const code = emitStep(step, symbols, false, stepId);
      if (!code) continue;

      // graphql and fetch steps self-capture their result into _results[stepId]
      const selfCaptures = stepId && (stepType === 'graphql' || stepType === 'fetch');

      const isResultProducing = stepId && !selfCaptures && (
        stepType === 'fetchData' ||
        stepType === 'runJavaScript' || stepType === 'customJavaScript' ||
        stepType === 'fetchCollection' || stepType === 'fetchCollectionsParallel'
      );

      if (isResultProducing) {
        const resultCapture = [
          `{`,
          ...code.split('\n').map(l => `  ${l}`),
          `  _results[${JSON.stringify(stepId)}] = { result: undefined };`,
          `}`,
        ];
        resultCapture.forEach(line => lines.push(`  ${line}`));
      } else {
        code.split('\n').forEach(line => lines.push(`  ${line}`));
      }
    }
  } catch (err) {
    throw new Error(`[codegen] Workflow "${id}": ${(err as Error).message}`);
  }

  lines.push(`}`);
  return lines.join('\n');
}

/** Common imports header shared by all domain action files. */
function emitImports(ctx: CodegenCtx): string {
  const lines: string[] = [];
  lines.push(`import { useStore, buildQueryString, mergeAtPath, setNestedValue, cycleAtPath, appendToPath, removeAtPath, toggleAtPath, bumpAtPath } from '../store';`);
  if (ctx.flags.hasThemeActions) {
    lines.push(`import { setTheme } from '../theme';`);
  }
  // Import all utility functions — formulas can reference any of them and we can't
  // statically determine which ones each domain file will need without analysing emitted code.
  lines.push(`import {`);
  lines.push(`  ifThen, ifEmpty, not, and, or, equal, notEqual, switchOn,`);
  lines.push(`  average, rollupSum, round, sum, toNumber, abs, ceil, clamp, floor, max, min, mod, pow, sqrt, toFixed,`);
  lines.push(`  lower, upper, capitalize, trim, startsWith, endsWith, replace, split, concat, textLength, substring, padStart, padEnd,`);
  lines.push(`  formatCurrency, formatNumber, formatDate, formatRelativeTime,`);
  lines.push(`  add, contains, includes, createArray, distinct, filterByKey, findIndex, getByIndex, at, join, length,`);
  lines.push(`  lookup, merge, prepend, remove, removeByIndex, reverse, slice, sort, flat, arrayIncludes, arrayLength, toggleInArray,`);
  lines.push(`  keys, values, entries, has, get, set, omit, pick,`);
  lines.push(`  now, today, toDate, isBefore, isAfter,`);
  lines.push(`  getFromMap, getKeyValue, findItemById, clampNumber, formatFullName, toText, stringify,`);
  lines.push(`  groupBy, paginationPages, lookupInArray, lookupMap, filterExcludeByFieldAndSlice, findItemByOptionsMatch,`);
  lines.push(`} from '../utils';`);
  lines.push(`import { createActionCtx, type ActionCtx } from '../action-ctx';`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Emit all workflow functions split into one file per source config domain.
 * Also emits a barrel `lib/actions/index.ts` that re-exports everything.
 *
 * Returns an array of EmittedFile objects (one per domain + the barrel).
 */
export function emitWorkflowFiles(ctx: CodegenCtx): EmittedFile[] {
  const { store, symbols } = ctx;

  const allWorkflows: Record<string, object[]> = Object.fromEntries(
    Object.entries(store.workflows ?? {}).map(([id, wf]) => [id, (wf as { steps?: object[] }).steps ?? []])
  );

  if (Object.keys(allWorkflows).length === 0) return [];

  // Build group map: configName → workflowId[]
  // Use pageWorkflowGroups from store (populated by config-to-state) when available,
  // otherwise fall back to a single "shared" bucket.
  const rawGroups = (store as Record<string, unknown>).pageWorkflowGroups as Record<string, string[]> | undefined;

  // Deduplicate: the same workflow ID can appear in multiple config files when a shared
  // file (e.g. layout.json) and a per-route file both define the same action ID.
  // Object.assign uses "last writer wins" semantics, so we do the same: iterate in the
  // same order as config-to-state and let later entries overwrite earlier ones.
  const idToGroup = new Map<string, string>();
  if (rawGroups) {
    for (const [configName, ids] of Object.entries(rawGroups)) {
      for (const id of ids) {
        if (id in allWorkflows) idToGroup.set(id, configName); // last writer wins
      }
    }
  }

  // Reconstruct groups from the deduplicated map
  const groups: Record<string, string[]> = {};
  for (const [id, configName] of idToGroup.entries()) {
    (groups[configName] ??= []).push(id);
  }

  // Any IDs not covered by a group go into an "other" bucket
  const coveredIds = new Set(idToGroup.keys());
  const ungroupedIds = Object.keys(allWorkflows).filter(id => !coveredIds.has(id));
  if (ungroupedIds.length > 0) groups['shared'] = ungroupedIds;

  const files: EmittedFile[] = [];

  for (const [configName, ids] of Object.entries(groups)) {
    const fileLines: string[] = [];
    fileLines.push(emitImports(ctx));

    let hasExports = false;
    for (const id of ids) {
      const steps = allWorkflows[id];
      if (!steps) continue;
      fileLines.push(emitActionFunction(id, steps, ctx));
      fileLines.push('');
      hasExports = true;
    }

    if (!hasExports) continue;

    // Normalise the file name: lowercase alphanumeric + hyphens only
    const slug = configName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    files.push({
      path: `lib/actions/${slug}.ts`,
      content: fileLines.join('\n'),
    });
  }

  // Barrel index re-exports all functions so callers can do:
  //   import { signIn } from 'lib/actions'
  const barrelLines: string[] = [];
  const barrelSeenNames = new Set<string>();
  for (const [configName] of Object.entries(groups)) {
    const slug = configName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const validIds = groups[configName]!.filter(id => id in allWorkflows);
    // Deduplicate names (safety guard against two IDs with the same resolved symbol)
    const names = validIds
      .map(id => symbols.workflows.get(id) ?? id)
      .filter(name => { if (barrelSeenNames.has(name)) return false; barrelSeenNames.add(name); return true; });
    if (names.length > 0) {
      barrelLines.push(`export { ${names.join(', ')} } from './${slug}';`);
    }
  }
  // Also re-export ActionCtx type so pages can import it from the same place
  barrelLines.push(`export type { ActionCtx } from '../action-ctx';`);

  files.push({
    path: 'lib/actions/index.ts',
    content: barrelLines.join('\n') + '\n',
  });

  return files;
}

// Keep the old single-file emitter as a compatibility shim — used nowhere
// in the updated pipeline but avoids breaking any external callers.
export function emitWorkflows(ctx: CodegenCtx): string {
  return emitWorkflowFiles(ctx)
    .filter(f => !f.path.endsWith('/index.ts'))
    .map(f => f.content)
    .join('\n');
}

/** Kept for callers that still import the old interface name. */
export interface WorkflowCtxType {
  state: string;
  dispatch: string;
  router: string;
  api: string;
  form: string;
  popover: string;
  event: string;
}
