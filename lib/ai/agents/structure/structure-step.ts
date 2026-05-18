/**
 * Phase H \u2014 Deterministic Structure step. Consumes the manifest's structure
 * contracts (ManifestOperation.agents.structure) and creates EMPTY entries
 * for new resources (nodes / variables / formulas / workflows / data sources)
 * so downstream agents (UI, Animation, Workflow, Data, Binding) only ever
 * mutate already-existing IDs. This eliminates a whole class of phantom-id
 * bugs the previous LLM-driven structure phase produced.
 *
 * "Deterministic" = no LLM. It runs server-side with simple TS rules and emits
 * `tool_executed` events that the client applies via the existing executor.
 */

import type { ContractManifest } from '../manifest';

export interface StructureStepEmit {
  type: 'tool_executed';
  id: string;
  name: string;
  input: Record<string, unknown>;
  phase: 'structure';
}

export interface StructureStepResult {
  emitted: StructureStepEmit[];
  /** Counts for the structure_complete SSE event (Phase O). */
  counts: { nodes: number; variables: number; formulas: number; workflows: number; dataSources: number };
}

let counter = 0;

/** Stamp a stable _sharedKey on every node in an SC content tree that lacks one. */
function stampSharedKeys(node: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...node };
  if (!result._sharedKey) {
    result._sharedKey = result.id ?? `sk-${counter++}`;
  }
  if (Array.isArray(result.children)) {
    result.children = (result.children as Record<string, unknown>[]).map(stampSharedKeys);
  }
  return result;
}

export function runStructureStep(manifest: ContractManifest): StructureStepResult {
  const emitted: StructureStepEmit[] = [];
  let nodes = 0;
  let variables = 0;
  let formulas = 0;
  let workflows = 0;
  let dataSources = 0;

  // ── Process sharedComponentsToCreate BEFORE operations ────────────────────
  // Planner authors full inline SC content. Structure step creates the model
  // with complete content and stamps _sharedKey on every internal node.
  // This must run before operations so instances placed on pages have the model
  // available when page agents start (all three override paths work immediately).
  for (const sc of manifest.sharedComponentsToCreate ?? []) {
    const contentWithKeys = sc.content ? stampSharedKeys(sc.content as Record<string, unknown>) : { type: 'Box', props: { className: 'flex flex-col' }, children: [] };
    emitted.push({
      type: 'tool_executed',
      id: `struct-sc-${counter++}`,
      name: 'create_shared_component',
      input: {
        id: sc.id,
        name: sc.name,
        description: sc.description,
        content: contentWithKeys,
        properties: sc.properties ?? [],
        variables: sc.variables ?? {},
        formulas: sc.formulas ?? {},
        workflows: sc.workflows ?? {},
        triggers: sc.triggers ?? [],
        ...(sc.valueVariable ? { valueVariable: sc.valueVariable } : {}),
      },
      phase: 'structure',
    });
    nodes += 1;
  }

  for (const op of manifest.operations) {
    const sc = op.agents.structure;
    if (!sc) continue;
    const ctx = (sc.context ?? {}) as Record<string, unknown>;

    // Empty-node creation \u2014 declare ids only; UI/Styling agents will fill in className/style.
    if (Array.isArray(ctx.nodes)) {
      const tree = ctx.nodes as Array<Record<string, unknown>>;
      emitted.push({
        type: 'tool_executed',
        id: `struct-${op.id}-tree-${counter++}`,
        name: 'generate_structure',
        input: { tree, parentId: ctx.parentId, atIndex: ctx.atIndex, _opId: op.id },
        phase: 'structure',
      });
      nodes += countNodes(tree);
    }

    if (Array.isArray(ctx.variables)) {
      for (const v of ctx.variables as Array<Record<string, unknown>>) {
        emitted.push({
          type: 'tool_executed',
          id: `struct-${op.id}-var-${counter++}`,
          name: 'add_variable',
          input: { ...v, _opId: op.id },
          phase: 'structure',
        });
        variables += 1;
      }
    }

    if (Array.isArray(ctx.formulas)) {
      for (const f of ctx.formulas as Array<Record<string, unknown>>) {
        emitted.push({
          type: 'tool_executed',
          id: `struct-${op.id}-formula-${counter++}`,
          name: 'add_formula',
          input: { ...f, _opId: op.id },
          phase: 'structure',
        });
        formulas += 1;
      }
    }

    if (Array.isArray(ctx.workflows)) {
      for (const w of ctx.workflows as Array<Record<string, unknown>>) {
        emitted.push({
          type: 'tool_executed',
          id: `struct-${op.id}-wf-${counter++}`,
          name: 'create_workflow',
          input: { ...w, steps: w.steps ?? [], _opId: op.id },
          phase: 'structure',
        });
        workflows += 1;
      }
    }

    if (Array.isArray(ctx.dataSources)) {
      for (const d of ctx.dataSources as Array<Record<string, unknown>>) {
        emitted.push({
          type: 'tool_executed',
          id: `struct-${op.id}-ds-${counter++}`,
          name: 'add_data_source',
          input: { ...d, _opId: op.id },
          phase: 'structure',
        });
        dataSources += 1;
      }
    }
  }

  return { emitted, counts: { nodes, variables, formulas, workflows, dataSources } };
}

function countNodes(nodes: Array<Record<string, unknown>>): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    const ch = node.children;
    if (Array.isArray(ch)) n += countNodes(ch as Array<Record<string, unknown>>);
  }
  return n;
}
