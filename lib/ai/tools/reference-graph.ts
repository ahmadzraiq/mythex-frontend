/**
 * Reference Graph — "Find All References" for the builder.
 *
 * Built once per request (~3-5ms), cached for the turn. Walks every artifact
 * (workflows, node bindings/actions, formulas) and builds a bidirectional
 * writers/readers map so the Context Agent can answer:
 *   - "which workflow sets this variable?"
 *   - "which nodes bind to this data source?"
 *   - "what fields of userProfile are actually consumed?"
 *
 * No LLM, no network. Pure in-memory graph construction.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArtifactKind = 'node' | 'variable' | 'workflow' | 'formula' | 'dataSource';

export interface ArtifactRef {
  kind: ArtifactKind;
  id: string;
  /** Step index within a workflow, or binding slot on a node */
  detail?: string;
}

export interface ReferenceGraph {
  /** ArtifactRef serialized as key → list of ArtifactRefs that write/set it */
  writers: Map<string, ArtifactRef[]>;
  /** ArtifactRef serialized as key → list of ArtifactRefs that read/consume it */
  readers: Map<string, ArtifactRef[]>;
  /** Variable ID → list of dot-paths actually accessed (e.g. ["firstName","email"]) */
  fieldsAccessed: Map<string, string[]>;
  /** Variable ID → inferred shape { fieldName: "string" | "number" | ... } */
  inferredShape: Map<string, Record<string, string>>;
  /** DataSource ID → dot-paths actually consumed from it */
  dsPathsAccessed: Map<string, string[]>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function refKey(ref: ArtifactRef): string {
  return `${ref.kind}:${ref.id}`;
}

function addEdge(map: Map<string, ArtifactRef[]>, targetKey: string, source: ArtifactRef) {
  const list = map.get(targetKey) ?? [];
  list.push(source);
  map.set(targetKey, list);
}

/** Extract all variable IDs referenced in a formula/binding string */
function extractVariableRefs(expr: string): Array<{ id: string; path: string }> {
  const out: Array<{ id: string; path: string }> = [];
  // variables['var-id'].some.path  or  variables["var-id"].field
  const re = /variables\[['"]([^'"]+)['"]\](?:\.([a-zA-Z0-9_.[\]]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    out.push({ id: m[1], path: m[2] ?? '' });
  }
  return out;
}

/** Extract all data source IDs referenced in a formula/binding string */
function extractDataSourceRefs(expr: string): Array<{ id: string; path: string }> {
  const out: Array<{ id: string; path: string }> = [];
  // collections['ds-id'].response.users  or  collections["ds-id"].data[0].name
  const re = /collections\[['"]([^'"]+)['"]\](?:\.([a-zA-Z0-9_.[\]]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    out.push({ id: m[1], path: m[2] ?? '' });
  }
  return out;
}

/** Walk any value recursively and collect all strings (for binding scanning) */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out);
  }
  return out;
}

/** Infer a type string from a JS value */
function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  return 'object';
}

// ─── Graph builder ────────────────────────────────────────────────────────────

export interface BuildGraphInput {
  /** Flat node list for current page — id, props, styles, actions, condition, map */
  nodeFlat: Array<{
    id: string;
    name?: string;
    type?: string;
    text?: string;
    path: string;
    parentId?: string;
    blob: string;
  }>;
  variables: Array<{
    id?: string;
    name: string;
    label?: string;
    type: string;
    initialValue?: unknown;
  }>;
  workflows: Array<{
    id?: string;
    name: string;
    trigger?: string;
    stepTypes?: string[];
    steps?: unknown;
    scope?: string;
  }>;
  globalFormulas: Array<{ name: string; preview: string }>;
  dataSources: Array<{ id: string; label: string; path: string; schema?: string; sampleResponse?: string }>;
}

export function buildReferenceGraph(input: BuildGraphInput): ReferenceGraph {
  const writers = new Map<string, ArtifactRef[]>();
  const readers = new Map<string, ArtifactRef[]>();
  const fieldsAccessed = new Map<string, string[]>();
  const inferredShape = new Map<string, Record<string, string>>();
  const dsPathsAccessed = new Map<string, string[]>();

  // ── 1. Walk workflows → find setVariable steps and trigger bindings ──────────
  for (const wf of input.workflows) {
    if (!wf.id) continue;
    const wfRef: ArtifactRef = { kind: 'workflow', id: wf.id };

    // Walk all strings in steps to find variable/datasource refs
    const stepsStrings = collectStrings(wf.steps ?? []);
    let stepIndex = 0;

    // Also try to parse structured steps if available
    const steps = Array.isArray(wf.steps) ? wf.steps as Array<Record<string, unknown>> : [];
    for (const step of steps) {
      const stepRef: ArtifactRef = { kind: 'workflow', id: wf.id, detail: `step:${stepIndex}` };

      // setVariable step
      if (typeof step.type === 'string' && /setVariable|set_variable/i.test(step.type)) {
        const varId = String(step.variableId ?? step.target ?? step.variable ?? '');
        if (varId) {
          addEdge(writers, `variable:${varId}`, stepRef);
          // If the value references a datasource, note that
          const valStr = JSON.stringify(step.value ?? '');
          for (const dsRef of extractDataSourceRefs(valStr)) {
            addEdge(readers, `dataSource:${dsRef.id}`, stepRef);
            const paths = dsPathsAccessed.get(dsRef.id) ?? [];
            if (dsRef.path && !paths.includes(dsRef.path)) paths.push(dsRef.path);
            dsPathsAccessed.set(dsRef.id, paths);
          }
        }
      }

      // All steps: scan for variable/datasource references in string values
      const stepStr = JSON.stringify(step);
      for (const ref of extractVariableRefs(stepStr)) {
        addEdge(readers, `variable:${ref.id}`, stepRef);
        if (ref.path) {
          const fields = fieldsAccessed.get(ref.id) ?? [];
          const field = ref.path.split('.')[0];
          if (field && !fields.includes(field)) fields.push(field);
          fieldsAccessed.set(ref.id, fields);
        }
      }
      for (const ref of extractDataSourceRefs(stepStr)) {
        addEdge(readers, `dataSource:${ref.id}`, stepRef);
        if (ref.path) {
          const paths = dsPathsAccessed.get(ref.id) ?? [];
          if (!paths.includes(ref.path)) paths.push(ref.path);
          dsPathsAccessed.set(ref.id, paths);
        }
      }

      stepIndex++;
    }

    // Fallback: scan all workflow strings for refs
    for (const s of stepsStrings) {
      for (const ref of extractVariableRefs(s)) {
        addEdge(readers, `variable:${ref.id}`, wfRef);
        if (ref.path) {
          const fields = fieldsAccessed.get(ref.id) ?? [];
          const field = ref.path.split('.')[0];
          if (field && !fields.includes(field)) fields.push(field);
          fieldsAccessed.set(ref.id, fields);
        }
      }
      for (const ref of extractDataSourceRefs(s)) {
        addEdge(readers, `dataSource:${ref.id}`, wfRef);
      }
    }
  }

  // ── 2. Walk node blobs → find variable/datasource bindings and action refs ──
  for (const n of input.nodeFlat) {
    const nodeRef: ArtifactRef = { kind: 'node', id: n.id };

    // Scan the full blob for variable and datasource refs
    for (const ref of extractVariableRefs(n.blob)) {
      addEdge(readers, `variable:${ref.id}`, nodeRef);
      if (ref.path) {
        const fields = fieldsAccessed.get(ref.id) ?? [];
        const field = ref.path.split('.')[0];
        if (field && !fields.includes(field)) fields.push(field);
        fieldsAccessed.set(ref.id, fields);
      }
    }
    for (const ref of extractDataSourceRefs(n.blob)) {
      addEdge(readers, `dataSource:${ref.id}`, nodeRef);
      if (ref.path) {
        const paths = dsPathsAccessed.get(ref.id) ?? [];
        if (!paths.includes(ref.path)) paths.push(ref.path);
        dsPathsAccessed.set(ref.id, paths);
      }
    }

    // Scan actions for workflow trigger refs: runWorkflow('wf-id')
    const actionStr = n.blob;
    const wfRe = /runWorkflow\(['"]([^'"]+)['"]\)/g;
    let wfM: RegExpExecArray | null;
    while ((wfM = wfRe.exec(actionStr)) !== null) {
      addEdge(readers, `workflow:${wfM[1]}`, nodeRef);
    }
  }

  // ── 3. Walk global formulas → find variable/datasource refs ─────────────────
  for (const f of input.globalFormulas) {
    const formulaRef: ArtifactRef = { kind: 'formula', id: f.name };
    for (const ref of extractVariableRefs(f.preview)) {
      addEdge(readers, `variable:${ref.id}`, formulaRef);
    }
    for (const ref of extractDataSourceRefs(f.preview)) {
      addEdge(readers, `dataSource:${ref.id}`, formulaRef);
    }
  }

  // ── 4. Build inferredShape for variables from fieldsAccessed ─────────────────
  for (const v of input.variables) {
    if (!v.id) continue;
    const accessed = fieldsAccessed.get(v.id) ?? [];
    if (accessed.length > 0) {
      const shape: Record<string, string> = {};
      // Try to get types from initialValue if available
      const iv = v.initialValue as Record<string, unknown> | undefined;
      for (const field of accessed) {
        shape[field] = iv && field in iv ? inferType(iv[field]) : 'string';
      }
      inferredShape.set(v.id, shape);
    } else if (v.initialValue && typeof v.initialValue === 'object' && !Array.isArray(v.initialValue)) {
      // Build shape from initialValue directly if no accessed fields
      const shape: Record<string, string> = {};
      for (const [k, val] of Object.entries(v.initialValue as Record<string, unknown>)) {
        shape[k] = inferType(val);
      }
      if (Object.keys(shape).length > 0) inferredShape.set(v.id, shape);
    }
  }

  return { writers, readers, fieldsAccessed, inferredShape, dsPathsAccessed };
}

/** Serialise a ref key for lookups */
export function artifactRefKey(kind: ArtifactKind, id: string): string {
  return `${kind}:${id}`;
}

/** Get all writers for an artifact */
export function getWriters(graph: ReferenceGraph, kind: ArtifactKind, id: string): ArtifactRef[] {
  return graph.writers.get(artifactRefKey(kind, id)) ?? [];
}

/** Get all readers for an artifact */
export function getReaders(graph: ReferenceGraph, kind: ArtifactKind, id: string): ArtifactRef[] {
  return graph.readers.get(artifactRefKey(kind, id)) ?? [];
}
