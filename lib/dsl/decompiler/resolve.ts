/**
 * UUID resolution helpers for the decompiler.
 *
 * The builder store uses UUIDs for variable and workflow references.
 * These maps let the decompiler convert UUIDs back to human-readable DSL names.
 */

import type { BuilderStore } from '@/app/dev/builder/_store-types';

export interface ResolveContext {
  /** UUID → var path, e.g. "abc-123" → "store/displayValue" */
  uuidToVar: Map<string, string>;
  /** UUID → workflow name, e.g. "def-456" → "handlePress" */
  uuidToWorkflow: Map<string, string>;
}

export function buildResolveContext(store: BuilderStore): ResolveContext {
  const uuidToVar     = new Map<string, string>();
  const uuidToWorkflow = new Map<string, string>();

  // Variables: id is the UUID, name is the display name
  for (const v of store.customVars ?? []) {
    if (v.id && v.name) {
      uuidToVar.set(v.id, v.name);
    }
  }

  // All workflows (unified store)
  for (const [id, wf] of Object.entries(store.workflows ?? {})) {
    if ((wf as { name?: string })?.name) uuidToWorkflow.set(id, (wf as { name: string }).name);
  }

  return { uuidToVar, uuidToWorkflow };
}

/**
 * Rewrite any `{{variables['<uuid>']}}` or `variables['<uuid>']` patterns
 * in a string value back to `vars['<name>']` using the resolve context.
 */
export function resolveVarRefs(value: string, ctx: ResolveContext): string {
  if (typeof value !== 'string') return String(value);
  return value.replace(
    /variables\[['"]([0-9a-f-]{36})['"]\]/g,
    (_, uuid: string) => {
      const name = ctx.uuidToVar.get(uuid);
      return name ? `vars['${name}']` : `variables['${uuid}']`;
    },
  );
}
