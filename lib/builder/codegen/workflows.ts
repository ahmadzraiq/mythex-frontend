/**
 * workflows.ts — Emit page and global workflows as async functions.
 *
 * Each workflow becomes:
 *   export async function workflowName(ctx: WorkflowCtx): Promise<void> {
 *     const { state, dispatch, router, api, form, popover, event } = ctx;
 *     ... steps ...
 *   }
 */

import type { CodegenCtx } from './types';
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

export interface WorkflowCtxType {
  state: string;
  dispatch: string;
  router: string;
  api: string;
  form: string;
  popover: string;
  event: string;
}

export function emitWorkflows(ctx: CodegenCtx): string {
  const { store, symbols } = ctx;

  const lines: string[] = [];
  lines.push(`import { useStore, buildQueryString } from './store';`);
  lines.push(`import type { AppRouter } from './types';`);
  lines.push('');
  lines.push(`export interface WorkflowCtx {`);
  lines.push(`  state: ReturnType<typeof useStore.getState>;`);
  lines.push(`  dispatch: typeof useStore.setState;`);
  lines.push(`  router: AppRouter;`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`  api: Record<string, (...args: any[]) => Promise<any>>;`);
  lines.push(`  form?: import('react-hook-form').UseFormReturn<Record<string, unknown>>;`);
  lines.push(`  popover?: [Record<string, boolean>, (fn: (s: Record<string, boolean>) => Record<string, boolean>) => void];`);
  lines.push(`  event?: unknown;`);
  lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
  lines.push(`  context?: Record<string, any>;`);
  lines.push(`}`);
  lines.push('');

  // Merge page + global workflows
  const allWorkflows: Array<[string, object[]]> = [
    ...Object.entries(store.pageWorkflows ?? {}),
    ...Object.entries(store.globalWorkflows ?? {}),
  ];

  for (const [id, steps] of allWorkflows) {
    const fnName = symbols.workflows.get(id) ?? id;

    lines.push(`export async function ${fnName}(ctx: WorkflowCtx): Promise<void> {`);
    lines.push(`  const { state, dispatch, router, api, form, popover, event } = ctx;`);
    lines.push(`  void dispatch; void api; void event;`);
    // _results tracks each step's return value; `context` mirrors the builder engine's
    // context.workflow.<stepId>.result pattern so formulas using it compile correctly.
    lines.push(`  const _results: Record<string, { result?: unknown }> = {};`);
    lines.push(`  const context = { ...(ctx.context ?? {}), workflow: _results, event };`);
    lines.push(`  void context;`);
    // wwLib polyfill — maps WeWeb engine API calls to exported app equivalents
    lines.push(`  // eslint-disable-next-line @typescript-eslint/no-explicit-any`);
    lines.push(`  const wwLib = {`);
    lines.push(`    variables: {`);
    lines.push(`      get: (name: string) => (useStore.getState().variables as any)[name],`);
    lines.push(`      set: (name: string, value: unknown) => useStore.setState((s: any) => ({ ...s, variables: { ...s.variables, [name]: value } })),`);
    lines.push(`    },`);
    lines.push(`    navigate: {`);
    lines.push(`      to: (opts: any) => { if (opts?.linkType === 'external') { if (typeof window !== 'undefined') window.open(opts.externalUrl, opts.newTab ? '_blank' : '_self'); } else { const qs = opts?.queryParams ? '?' + new URLSearchParams(opts.queryParams).toString() : ''; router.push((opts?.path ?? '/') + qs); } },`);
    lines.push(`      prev: (defaultPath?: string) => { try { router.back(); } catch { if (defaultPath) router.push(defaultPath); } },`);
    lines.push(`    },`);
    lines.push(`    collections: {`);
    lines.push(`      refetch: (_name: string) => Promise.resolve(),`);
    lines.push(`      update: (_name: string, _mode: string, _item: unknown, _key?: string) => Promise.resolve(),`);
    lines.push(`    },`);
    lines.push(`    workflows: {`);
    lines.push(`      run: (_name: string, _params?: unknown) => Promise.resolve(),`);
    lines.push(`    },`);
    lines.push(`    popovers: {`);
    lines.push(`      open: (id: string) => { if (popover) { const [, set] = popover; set((s: any) => ({ ...s, [id]: true })); } },`);
    lines.push(`      close: (id: string) => { if (popover) { const [, set] = popover; set((s: any) => ({ ...s, [id]: false })); } },`);
    lines.push(`      toggle: (id: string) => { if (popover) { const [s, set] = popover; set((st: any) => ({ ...st, [id]: !s[id] })); } },`);
    lines.push(`    },`);
    lines.push(`    forms: {`);
    lines.push(`      setState: (_formId: string, _st: unknown) => {},`);
    lines.push(`      reset: (_formId: string) => { form?.reset(); },`);
    lines.push(`    },`);
    lines.push(`    auth: {`);
    lines.push(`      authenticate: (_opts: unknown) => Promise.resolve(null),`);
    lines.push(`      setUser: (user: unknown) => useStore.setState((s: any) => ({ ...s, auth: { ...s.auth, user } })),`);
    lines.push(`      clearSession: () => { if (typeof window !== 'undefined') { localStorage.removeItem('auth_token'); localStorage.removeItem('access_token'); } useStore.setState((s: any) => ({ ...s, auth: { ...s.auth, token: null, user: null } })); },`);
    lines.push(`      restoreSession: () => Promise.resolve(null),`);
    lines.push(`    },`);
    lines.push(`    actions: { run: (_step: unknown) => Promise.resolve() },`);
    lines.push(`    event: { stopPropagation: () => {} },`);
    lines.push(`    scroll: { to: (_selector: string) => { if (typeof document !== 'undefined') document.querySelector(_selector)?.scrollIntoView({ behavior: 'smooth' }); } },`);
    lines.push(`    print: { pdf: () => { if (typeof window !== 'undefined') window.print(); } },`);
    lines.push(`    clipboard: { copy: (text: string) => navigator?.clipboard?.writeText(text) },`);
    lines.push(`    timing: { delay: (ms: number) => new Promise(r => setTimeout(r, ms)) },`);
    lines.push(`    files: {`);
    lines.push(`      download: (url: string, filename?: string) => { const a = document.createElement('a'); a.href = url; if (filename) a.download = filename; a.click(); },`);
    lines.push(`      fromBase64: (b64: string, type = 'application/octet-stream') => \`data:\${type};base64,\${b64}\`,`);
    lines.push(`    },`);
    lines.push(`    shared: { add: () => {}, delete: () => {}, deleteAll: () => {} },`);
    lines.push(`    components: { run: () => Promise.resolve(), emit: () => {} },`);
    lines.push(`  };`);
    lines.push(`  void wwLib;`);
    lines.push('');

    try {
      for (let step of steps as Record<string, unknown>[]) {
        // Pre-process triggerExitAnimation: resolve the target node's exit animation config
        // since the step's config doesn't store the animation type — it's on the node itself.
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
        const code = emitStep(step, symbols);
        if (!code) continue;

        // For result-producing steps, capture the return value so context.workflow works
        const isResultProducing = stepId && (
          stepType === 'fetch' || stepType === 'fetchData' || stepType === 'graphql' ||
          stepType === 'runJavaScript' || stepType === 'customJavaScript' ||
          stepType === 'fetchCollection' || stepType === 'fetchCollectionsParallel'
        );

        if (isResultProducing) {
          // Wrap the step code in a block that captures the result
          const resultCapture = [
            `{`,
            ...code.split('\n').map(l => `  ${l}`),
            `  // Expose result for context.workflow.${stepId}.result`,
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
    lines.push('');
  }

  return lines.join('\n');
}
