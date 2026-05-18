/**
 * Read Tools — two generic tools replacing the 10 individual get_* tools.
 *
 * Like Cursor's `grep` + `read_file`:
 *   search(query, kinds?) — find / list anything by regex
 *   read(kind, id, path?, depth?) — get-by-id with path slicing and depth control
 *
 * Both are pure functions (~ms), backed by the ReadContext snapshot built once
 * at request start. No network, no LLM, no side effects.
 */

import {
  buildReferenceGraph,
  getWriters,
  getReaders,
  artifactRefKey,
  type ReferenceGraph,
  type BuildGraphInput,
} from './reference-graph';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArtifactKind =
  | 'node'
  | 'variable'
  | 'workflow'
  | 'formula'
  | 'dataSource'
  | 'sharedComponent'
  | 'page'
  | 'theme';

export interface NodeFlat {
  id: string;
  name?: string;
  type?: string;
  text?: string;
  path: string;
  parentId?: string;
  blob: string;
}

export interface ReadContext {
  nodeFlat: NodeFlat[];
  /** Compact index for other (non-current) pages */
  otherPagesIndex: Array<{
    pageId: string;
    pageName: string;
    pageRoute?: string;
    nodes: Array<{ id: string; name?: string; type?: string; text?: string; blob?: string }>;
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
  dataSources: Array<{
    id: string;
    label: string;
    path: string;
    schema?: string;
    sampleResponse?: string;
  }>;
  sharedComponents?: Array<{ id: string; name: string }>;
  pages?: Array<{ id: string; name: string; route: string }>;
  theme?: Record<string, string>;
  /** Current page id for scope filtering */
  currentPageId?: string;
  currentPageRoute?: string;
  /** Pre-built reference graph — computed once and reused */
  referenceGraph?: ReferenceGraph;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchInput {
  query: string;
  kinds?: ArtifactKind[];
  scope?: 'currentPage' | 'allPages';
  limit?: number;
}

export type SearchHit =
  | NodeHit
  | VariableHit
  | WorkflowHit
  | FormulaHit
  | DataSourceHit
  | SharedComponentHit
  | PageHit
  | ThemeHit;

export interface NodeHit {
  kind: 'node';
  id: string;
  name?: string;
  type?: string;
  pageRoute: string;
  path: string;
  parentId?: string;
  parentName?: string;
}

export interface VariableHit {
  kind: 'variable';
  id: string;
  name: string;
  label?: string;
  type: string;
  scope?: string;
  /** Dot-paths inside initialValue that matched the query */
  paths?: string[];
  writers?: Array<{ kind: string; id: string; detail?: string }>;
  readers?: Array<{ kind: string; id: string; detail?: string }>;
  fieldsAccessed?: string[];
  inferredShape?: Record<string, string>;
}

export interface WorkflowHit {
  kind: 'workflow';
  id: string;
  name: string;
  trigger?: string;
  stepTypes?: string[];
  scope?: string;
  /** Which nodes trigger this workflow */
  readers?: Array<{ kind: string; id: string; detail?: string }>;
  /** Variables/datasources this workflow writes */
  writes?: Array<{ kind: string; id: string }>;
}

export interface FormulaHit {
  kind: 'formula';
  name: string;
  preview: string;
  reads?: Array<{ kind: string; id: string }>;
}

export interface DataSourceHit {
  kind: 'dataSource';
  id: string;
  label: string;
  path: string;
  hasSchema: boolean;
  hasSample: boolean;
  /** Dot-paths inside sampleResponse that matched the query */
  paths?: string[];
  readers?: Array<{ kind: string; id: string; detail?: string }>;
  pathsAccessed?: string[];
}

export interface SharedComponentHit {
  kind: 'sharedComponent';
  id: string;
  name: string;
}

export interface PageHit {
  kind: 'page';
  id: string;
  name: string;
  route: string;
  nodeCount?: number;
}

export interface ThemeHit {
  kind: 'theme';
  tokens: Record<string, string>;
}

export interface SearchResult {
  results: SearchHit[];
  truncated: boolean;
  totalMatches: number;
  /** Hint when nothing found */
  note?: string;
}

/** Find dot-paths in a JSON value where a key or value matches the pattern */
function findMatchingPaths(value: unknown, matcher: (s: string) => boolean, prefix = ''): string[] {
  const paths: string[] = [];
  if (typeof value === 'string') {
    if (matcher(value)) paths.push(prefix);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => {
      paths.push(...findMatchingPaths(v, matcher, prefix ? `${prefix}[${i}]` : `[${i}]`));
    });
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = prefix ? `${prefix}.${k}` : k;
      if (matcher(k)) paths.push(childPath);
      paths.push(...findMatchingPaths(v, matcher, childPath));
    }
  }
  return paths.slice(0, 10); // cap per-artifact
}

function buildMatcher(query: string): (s: string) => boolean {
  if (!query) return () => true;

  // Validate each |-separated alternative independently.
  // Invalid regex parts (e.g. unclosed parens like "rgba(239") are escaped
  // to literal matches so they don't poison the entire query.
  const parts = query.split('|').map(part => {
    try {
      new RegExp(part);
      return part;
    } catch {
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  });

  try {
    const re = new RegExp(parts.join('|'), 'i');
    return (s) => re.test(s);
  } catch {
    const lc = query.toLowerCase();
    return (s) => s.toLowerCase().includes(lc);
  }
}

// Build a map from node id → node name for parentName lookup
function buildNodeNameMap(nodeFlat: NodeFlat[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of nodeFlat) {
    if (n.id && n.name) m.set(n.id, n.name);
  }
  return m;
}

export function runSearch(input: SearchInput, ctx: ReadContext): SearchResult {
  const { query, kinds, scope = 'allPages', limit = 30 } = input;
  const matcher = buildMatcher(query);
  const graph = ctx.referenceGraph;
  const results: SearchHit[] = [];
  const allKinds = new Set<ArtifactKind>(kinds ?? ['node', 'variable', 'workflow', 'formula', 'dataSource', 'sharedComponent', 'page', 'theme']);
  const nodeNameMap = buildNodeNameMap(ctx.nodeFlat);

  // 1. Nodes on current page (full blob)
  if (allKinds.has('node')) {
    for (const n of ctx.nodeFlat) {
      if (results.length >= limit) break;
      if (!matcher(n.blob)) continue;
      results.push({
        kind: 'node',
        id: n.id,
        name: n.name,
        type: n.type,
        pageRoute: ctx.currentPageRoute ?? '/',
        path: n.path,
        parentId: n.parentId,
        parentName: n.parentId ? nodeNameMap.get(n.parentId) : undefined,
      });
    }

    // Nodes on other pages (compact index — blob includes props+styles for full style/color search)
    if (scope === 'allPages') {
      for (const page of ctx.otherPagesIndex) {
        for (const n of page.nodes) {
          if (results.length >= limit) break;
          const searchable = n.blob ?? [n.name, n.type, n.id, n.text].filter(Boolean).join(' ');
          if (!matcher(searchable)) continue;
          results.push({
            kind: 'node',
            id: n.id,
            name: n.name,
            type: n.type,
            pageRoute: page.pageRoute ?? page.pageName,
            path: n.name ?? n.id,
          });
        }
      }
    }
  }

  // 2. Variables
  if (allKinds.has('variable') && results.length < limit) {
    for (const v of ctx.variables) {
      if (results.length >= limit) break;
      const id = v.id ?? v.name;
      const ivStr = v.initialValue != null ? JSON.stringify(v.initialValue).slice(0, 1024) : '';
      const searchable = [id, v.name, v.label, v.type, ivStr].filter(Boolean).join(' ');
      if (!matcher(searchable)) continue;

      // Find matching paths inside initialValue
      const paths = v.initialValue != null ? findMatchingPaths(v.initialValue, matcher) : [];

      const hit: VariableHit = {
        kind: 'variable',
        id,
        name: v.name,
        label: v.label,
        type: v.type,
        paths: paths.length > 0 ? paths : undefined,
      };
      if (graph) {
        const w = getWriters(graph, 'variable', id);
        const r = getReaders(graph, 'variable', id);
        if (w.length > 0) hit.writers = w;
        if (r.length > 0) hit.readers = r;
        const fa = graph.fieldsAccessed.get(id);
        if (fa?.length) hit.fieldsAccessed = fa;
        const sh = graph.inferredShape.get(id);
        if (sh) hit.inferredShape = sh;
      }
      results.push(hit);
    }
  }

  // 3. Workflows
  if (allKinds.has('workflow') && results.length < limit) {
    for (const wf of ctx.workflows) {
      if (results.length >= limit) break;
      const id = wf.id ?? wf.name;
      const stepsStr = JSON.stringify(wf.steps ?? []).slice(0, 2048);
      const searchable = [id, wf.name, wf.trigger, ...(wf.stepTypes ?? []), stepsStr].filter(Boolean).join(' ');
      if (!matcher(searchable)) continue;

      const hit: WorkflowHit = {
        kind: 'workflow',
        id,
        name: wf.name,
        trigger: wf.trigger,
        stepTypes: wf.stepTypes,
        scope: wf.scope,
      };
      if (graph) {
        const r = getReaders(graph, 'workflow', id);
        if (r.length > 0) hit.readers = r;
      }
      results.push(hit);
    }
  }

  // 4. Formulas
  if (allKinds.has('formula') && results.length < limit) {
    for (const f of ctx.globalFormulas) {
      if (results.length >= limit) break;
      if (!matcher([f.name, f.preview].join(' '))) continue;
      results.push({ kind: 'formula', name: f.name, preview: f.preview });
    }
  }

  // 5. Data sources
  if (allKinds.has('dataSource') && results.length < limit) {
    for (const ds of ctx.dataSources) {
      if (results.length >= limit) break;
      const sampleStr = (ds.sampleResponse ?? '').slice(0, 2048);
      const searchable = [ds.id, ds.label, ds.path, ds.schema, sampleStr].filter(Boolean).join(' ');
      if (!matcher(searchable)) continue;

      // Find matching paths in sampleResponse
      let sampleObj: unknown = undefined;
      try { sampleObj = ds.sampleResponse ? JSON.parse(ds.sampleResponse) : undefined; } catch { /* ignore */ }
      const paths = sampleObj != null ? findMatchingPaths(sampleObj, matcher) : [];

      const hit: DataSourceHit = {
        kind: 'dataSource',
        id: ds.id,
        label: ds.label,
        path: ds.path,
        hasSchema: !!ds.schema,
        hasSample: !!ds.sampleResponse,
        paths: paths.length > 0 ? paths : undefined,
      };
      if (graph) {
        const r = getReaders(graph, 'dataSource', ds.id);
        if (r.length > 0) hit.readers = r;
        const accessed = graph.dsPathsAccessed.get(ds.id);
        if (accessed?.length) hit.pathsAccessed = accessed;
      }
      results.push(hit);
    }
  }

  // 6. Shared components
  if (allKinds.has('sharedComponent') && results.length < limit) {
    for (const sc of ctx.sharedComponents ?? []) {
      if (results.length >= limit) break;
      if (!matcher([sc.id, sc.name].join(' '))) continue;
      results.push({ kind: 'sharedComponent', id: sc.id, name: sc.name });
    }
  }

  // 7. Pages
  if (allKinds.has('page') && results.length < limit) {
    for (const p of ctx.pages ?? []) {
      if (results.length >= limit) break;
      if (!matcher([p.id, p.name, p.route].join(' '))) continue;
      results.push({ kind: 'page', id: p.id, name: p.name, route: p.route });
    }
  }

  // 8. Theme (singleton — always include if requested, matcher on token names+values)
  if (allKinds.has('theme') && ctx.theme && results.length < limit) {
    const tokenStr = Object.entries(ctx.theme).map(([k, v]) => `${k}: ${v}`).join(' ');
    if (matcher(tokenStr)) {
      results.push({ kind: 'theme', tokens: ctx.theme });
    }
  }

  const totalMatches = results.length; // capped at limit
  const truncated = results.length >= limit; // true when there may be more results

  if (results.length === 0) {
    return {
      results: [],
      truncated: false,
      totalMatches: 0,
      note: `No matches for "${query}". Try broader terms, | alternation for synonyms, or .* to connect two words anywhere in the same record (e.g. "signal1.*signal2").`,
    };
  }

  return { results: results.slice(0, limit), truncated, totalMatches };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export interface ReadInput {
  kind: ArtifactKind;
  id: string;
  path?: string;
  depth?: number;
}

export type ReadResult = Record<string, unknown> | null;

/** Walk a dot-path (e.g. "response.data[0].user") into a value */
function walkPath(value: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = value;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Truncate a node tree to `depth` levels, replacing deep children with stubs */
function truncateTree(node: unknown, depth: number): unknown {
  if (depth <= 0 || node == null || typeof node !== 'object') return node;
  const n = node as Record<string, unknown>;
  const children = Array.isArray(n.children) ? n.children as unknown[] : undefined;
  return {
    ...n,
    children: children
      ? depth > 1
        ? children.map(c => truncateTree(c, depth - 1))
        : children.map((c) => {
            const cn = c as Record<string, unknown>;
            return { id: cn.id, name: cn.name, type: cn.type, hasMoreChildren: Array.isArray(cn.children) ? (cn.children as unknown[]).length : 0 };
          })
      : undefined,
  };
}

export function runRead(input: ReadInput, ctx: ReadContext): ReadResult {
  const { kind, id, path, depth = 1 } = input;
  const graph = ctx.referenceGraph;

  switch (kind) {
    case 'node': {
      const node = ctx.nodeFlat.find(n => n.id === id);
      if (!node) return null;
      const base: Record<string, unknown> = { ...node };
      if (graph) {
        base.writers = getWriters(graph, 'node', id);
        base.readers = getReaders(graph, 'node', id);
      }
      return base;
    }

    case 'variable': {
      const v = ctx.variables.find(vv => (vv.id ?? vv.name) === id);
      if (!v) return null;
      let value: unknown = v.initialValue;
      if (path) value = walkPath(value, path);
      const base: Record<string, unknown> = {
        id: v.id ?? v.name,
        name: v.name,
        label: v.label,
        type: v.type,
        value: path ? value : v.initialValue,
        path: path ?? undefined,
      };
      if (graph) {
        base.writers = getWriters(graph, 'variable', id);
        base.readers = getReaders(graph, 'variable', id);
        base.fieldsAccessed = graph.fieldsAccessed.get(id);
        base.inferredShape = graph.inferredShape.get(id);
      }
      return base;
    }

    case 'workflow': {
      const wf = ctx.workflows.find(w => (w.id ?? w.name) === id);
      if (!wf) return null;
      let steps: unknown = wf.steps;
      if (path) steps = walkPath(steps, path);
      return {
        id: wf.id ?? wf.name,
        name: wf.name,
        trigger: wf.trigger,
        stepTypes: wf.stepTypes,
        scope: wf.scope,
        steps: path ? steps : wf.steps,
        path: path ?? undefined,
        readers: graph ? getReaders(graph, 'workflow', id) : undefined,
      };
    }

    case 'formula': {
      const f = ctx.globalFormulas.find(ff => ff.name === id);
      if (!f) return null;
      return { name: f.name, preview: f.preview };
    }

    case 'dataSource': {
      const ds = ctx.dataSources.find(d => d.id === id);
      if (!ds) return null;
      let sample: unknown = undefined;
      if (ds.sampleResponse) {
        try { sample = JSON.parse(ds.sampleResponse); } catch { /* ignore */ }
      }
      const value = path ? walkPath(sample, path) : sample;
      return {
        id: ds.id,
        label: ds.label,
        path: ds.path,
        schema: ds.schema,
        value: path ? value : undefined,
        sampleKeys: sample && typeof sample === 'object' && !Array.isArray(sample)
          ? Object.keys(sample as object).slice(0, 20)
          : undefined,
        hasSchema: !!ds.schema,
        hasSample: !!ds.sampleResponse,
        requestedPath: path ?? undefined,
        readers: graph ? getReaders(graph, 'dataSource', id) : undefined,
        pathsAccessed: graph ? graph.dsPathsAccessed.get(id) : undefined,
      };
    }

    case 'sharedComponent': {
      const sc = (ctx.sharedComponents ?? []).find(s => s.id === id);
      if (!sc) return null;
      return { id: sc.id, name: sc.name };
    }

    case 'page': {
      if (id === '*') return { pages: ctx.pages ?? [] };
      const p = (ctx.pages ?? []).find(pp => pp.id === id || pp.route === id);
      if (!p) return null;
      return { id: p.id, name: p.name, route: p.route };
    }

    case 'theme': {
      return ctx.theme ? { tokens: ctx.theme } : null;
    }

    default:
      return null;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build a ReadContext from the raw request data and optionally pre-compute the
 * reference graph. Call this once per request and reuse the ctx object.
 */
export function buildReadContext(
  data: Omit<ReadContext, 'referenceGraph'>,
  buildGraph = true,
): ReadContext {
  const ctx: ReadContext = { ...data };
  if (buildGraph) {
    const graphInput: BuildGraphInput = {
      nodeFlat: data.nodeFlat,
      variables: data.variables,
      workflows: data.workflows,
      globalFormulas: data.globalFormulas,
      dataSources: data.dataSources,
    };
    ctx.referenceGraph = buildReferenceGraph(graphInput);
  }
  return ctx;
}
