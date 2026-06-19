/**
 * decompile-workflows
 *
 * Converts builder store workflows back to source files matching Claude's style:
 *   - One file per workflow at `src/workflows/<name>.ts`
 *   - `import { defineWorkflow, setVar, vars, ... } from 'builder';`
 *   - `export default defineWorkflow({ path: '...', params: {} }, (params) => { ... });`
 */

import type { WorkflowMeta } from '@/app/dev/builder/_store-types';
import type { ResolveContext } from './resolve';

type StepRecord = Record<string, unknown>;

// ── Step → DSL call ───────────────────────────────────────────────────────────

interface StepResult {
  code: string;
  usedHelpers: Set<string>;
}

function serializeStep(step: StepRecord, ctx: ResolveContext, indent: number): StepResult {
  const pad     = '  '.repeat(indent);
  const type    = step.type as string | undefined;
  const cfg     = (step.config ?? {}) as Record<string, unknown>;
  const helpers = new Set<string>();

  switch (type) {
    case 'changeVariableValue': {
      const varId   = cfg.varId as string | undefined;
      const val     = cfg.value;
      const varName = varId ? (ctx.uuidToVar.get(varId) ?? varId) : '?';
      helpers.add('setVar');
      return { code: `${pad}setVar('${varName}', ${JSON.stringify(val)})`, usedHelpers: helpers };
    }

    case 'navigateTo': {
      const route = cfg.route ?? cfg.path;
      helpers.add('navigate');
      return { code: `${pad}navigate('${route ?? '/'}')`, usedHelpers: helpers };
    }

    case 'runJavaScript': {
      const code = (cfg.code as string ?? '// custom code')
        .split('\n')
        .map((l: string, i: number) => (i === 0 ? l : pad + l))
        .join('\n');
      // runJavaScript has no builder DSL equivalent — emit as a comment
      return { code: `${pad}// custom JS: ${code}`, usedHelpers: helpers };
    }

    case 'branch': {
      const cond = cfg.condition ?? cfg.if ?? 'true';
      return { code: `${pad}// if (${cond}) { ... } else { ... }`, usedHelpers: helpers };
    }

    case 'fetchCollection':
    case 'fetchItem': {
      const url = cfg.url ?? cfg.endpoint;
      const key = cfg.key ?? cfg.storeKey;
      return { code: `${pad}fetch('${url ?? ''}', { key: '${key ?? ''}' })`, usedHelpers: helpers };
    }

    default:
      return { code: `${pad}// ${type ?? 'step'}: ${JSON.stringify(cfg)}`, usedHelpers: helpers };
  }
}

// ── Single workflow → file source ─────────────────────────────────────────────

function serializeWorkflowFile(
  meta: WorkflowMeta,
  steps: StepRecord[],
  ctx: ResolveContext,
): string {
  const allHelpers = new Set<string>();
  const stepLines: string[] = [];

  for (const step of steps) {
    const { code, usedHelpers } = serializeStep(step as StepRecord, ctx, 2);
    stepLines.push(code);
    for (const h of usedHelpers) allHelpers.add(h);
  }

  // Detect if any step reads vars
  const bodyStr = stepLines.join('\n');
  if (bodyStr.includes("vars['")) allHelpers.add('vars');

  // Build params from meta
  const paramNames = (meta.params ?? []).map(p => p.name).filter(Boolean);
  const paramsObj  = paramNames.length > 0
    ? `{ ${paramNames.map(p => `${p}: ''`).join(', ')} }`
    : '{}';

  // Determine function signature
  const fnSignature = paramNames.length > 0 ? `(params) => {` : `() => {`;

  // Named imports
  const helperImports = ['defineWorkflow', ...Array.from(allHelpers).sort()];
  const importLine = `import { ${helperImports.join(', ')} } from 'builder';`;

  const lines: string[] = [
    importLine,
    '',
    'export default defineWorkflow(',
    `  { path: '${meta.name}', params: ${paramsObj} },`,
    `  ${fnSignature}`,
    ...stepLines,
    '  },',
    ');',
    '',
  ];

  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

function toSafeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Convert global workflows to a map of { filePath → source }.
 * Each workflow gets its own `src/workflows/<name>.ts` file.
 * Returns an empty object if there are no exportable workflows.
 */
export function decompileWorkflows(
  globalWorkflowMeta: Record<string, WorkflowMeta>,
  globalWorkflows: Record<string, unknown[]>,
  ctx: ResolveContext,
): Record<string, string> {
  const files: Record<string, string> = {};

  const exportable = Object.entries(globalWorkflowMeta).filter(
    ([, meta]) => !meta.isSystem && !meta.isTrigger && !meta.isAppTrigger,
  );

  for (const [id, meta] of exportable) {
    const steps    = (globalWorkflows[id] ?? []) as StepRecord[];
    const filename = toSafeFilename(meta.name ?? id);
    const filePath = `src/workflows/${filename}.ts`;
    files[filePath] = serializeWorkflowFile(meta, steps, ctx);
  }

  return files;
}
