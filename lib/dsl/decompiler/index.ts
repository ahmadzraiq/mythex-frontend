/**
 * decompileStore
 *
 * Entry point for the JSON → JSX decompiler.
 *
 * Produces a Record<filePath, source> that mirrors how Claude structures files:
 *  - src/store/<name>.ts      one per variable
 *  - src/workflows/<name>.ts  one per global workflow
 *  - src/pages/<name>.tsx     one per page
 */

import type { BuilderStore } from '@/app/dev/builder/_store-types';
import { buildResolveContext } from './resolve';
import { decompileVars } from './decompile-vars';
import { decompileWorkflows } from './decompile-workflows';
import { decompilePage } from './decompile-page';

export { buildResolveContext } from './resolve';
export { decompileNodes } from './decompile-nodes';

/**
 * Convert the full builder store state into a map of { filePath → sourceCode }.
 * The output mirrors Claude's file structure and syntax so the Builder (Decompiled)
 * view in the file drawer is directly comparable to the WebContainer sources.
 */
export function decompileStore(store: BuilderStore): Record<string, string> {
  const ctx   = buildResolveContext(store);
  const files: Record<string, string> = {};

  // Variables → src/store/<name>.ts (one per var)
  const varFiles = decompileVars(store.customVars ?? []);
  Object.assign(files, varFiles);

  // Global workflows → src/workflows/<name>.ts (one per workflow)
  // Build legacy-shaped maps from unified store.workflows (global = no pageScope, non-trigger)
  type WfEntry = { id: string; name?: string; trigger?: string; steps?: object[]; isTrigger?: boolean; isAppTrigger?: boolean; pageScope?: string };
  const globalWfEntries = Object.entries(store.workflows ?? {})
    .filter(([, w]) => !(w as WfEntry).pageScope && !(w as WfEntry).isTrigger && !(w as WfEntry).isAppTrigger);
  const wfMeta = Object.fromEntries(globalWfEntries.map(([id, w]) => [id, w as WfEntry]));
  const wfSteps = Object.fromEntries(globalWfEntries.map(([id, w]) => [id, ((w as WfEntry).steps ?? []) as unknown[]]));
  const wfFiles = decompileWorkflows(wfMeta, wfSteps, ctx);
  Object.assign(files, wfFiles);

  // Pages → src/pages/<name>.tsx
  for (const page of store.pages ?? []) {
    const source       = decompilePage(page, ctx);
    const safePageName = page.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    files[`src/pages/${safePageName}.tsx`] = source;
  }

  return files;
}
