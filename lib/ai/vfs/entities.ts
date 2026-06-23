/**
 * Entity extraction for the virtual file system.
 *
 * extractEntities(files, theme) returns one Entity per node (for node-bearing files)
 * and one Entity per resource file (store vars, workflows, triggers, datasources,
 * formulas, theme, routes, etc.).
 *
 * Each entity carries a `blob` — the full flattened, theme-expanded text used by
 * BOTH grep and embeddings. Nothing is dropped from the blob.
 *
 * Behavior denormalization: when a node has `actions`, the referenced workflow's
 * name + description are inlined into the node's blob so behavioral queries
 * ("the box that toggles status on click") find the node, not just the workflow.
 *
 * Meaningful predicate:
 *   - node entities: meaningful when they have a `name` or `_group` field
 *   - resource entities: always meaningful
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityKind =
  | 'node'
  | 'store'
  | 'workflow'
  | 'trigger'
  | 'datasource'
  | 'formula'
  | 'component'
  | 'theme'
  | 'routes'
  | 'resource';

export interface Entity {
  /** Stable cache key: "path#nodePath" for nodes, "path" for resources */
  key: string;
  /** VFS file path (no .json extension), e.g. "pages/home/groups/Pricing" */
  path: string;
  /** Best-effort 1-based line of the node's opening brace in the raw file (1 for resources) */
  line: number;
  name?: string;
  type?: string;
  kind: EntityKind;
  /** Full flattened, theme-expanded text. Used by grep (exhaustive) and embeddings (meaningful only). */
  blob: string;
  /** True when this entity should be indexed for vector search */
  meaningful: boolean;
}

// ─── Theme expansion ──────────────────────────────────────────────────────────

function expandTheme(text: string, theme: Record<string, string>): string {
  return text.replace(/var\(--theme-([^)]+)\)/g, (_match, key: string) => {
    const hex = theme[key];
    return hex ? hex : `var(--theme-${key})`;
  });
}

// ─── Node path helpers ────────────────────────────────────────────────────────

type RawNode = Record<string, unknown>;

/** Approximate the line number of a node by searching for its first unique token in the raw file. */
function findNodeLine(raw: string, node: RawNode): number {
  const id = node.id as string | undefined;
  const name = node.name as string | undefined;
  const type = node.type as string | undefined;

  // Try to find by id first (most unique), then name, then type
  const candidates = [
    id ? `"id": "${id}"` : null,
    id ? `"id":"${id}"` : null,
    name ? `"name": "${name}"` : null,
    name ? `"name":"${name}"` : null,
    type ? `"type": "${type}"` : null,
    type ? `"type":"${type}"` : null,
  ].filter(Boolean) as string[];

  const lines = raw.split('\n');
  for (const candidate of candidates) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(candidate)) return i + 1;
    }
  }
  return 1;
}

// ─── Blob builders ────────────────────────────────────────────────────────────

/** Build a blob for a single node (children excluded), optionally with workflow context. */
function buildNodeBlob(
  node: RawNode,
  workflowSummaries: string[],
  theme: Record<string, string>,
): string {
  const parts: string[] = [];

  const push = (v: unknown) => {
    if (v === null || v === undefined) return;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s) parts.push(s);
  };

  push(node.type);
  push(node.name);
  push(node.id);
  push(node.text);
  push(node.alt);
  push(node.src);
  push(node.key);

  // props (everything except children-like nested arrays)
  const props = node.props as Record<string, unknown> | undefined;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'children') continue;
      push(`${k}:${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }

  // top-level className (some nodes carry it outside props)
  if (node.className) push(node.className as string);

  // animation
  if (node.animation) push(JSON.stringify(node.animation));

  // popover — extract trigger word for semantic clarity
  const popover = node.popover as Record<string, unknown> | undefined;
  if (popover) {
    const trigger = popover.trigger;
    if (trigger === 'click') push('dropdown menu');
    else if (trigger === 'hover') push('tooltip');
    push(JSON.stringify(popover));
  }

  // map, condition, dataSource
  if (node.map) push(`map:${typeof node.map === 'string' ? node.map : JSON.stringify(node.map)} list repeated`);
  if (node.condition) push(`condition:${JSON.stringify(node.condition)} conditional`);
  const ds = node.dataSource as Record<string, unknown> | undefined;
  if (ds) push(JSON.stringify(ds));

  // actions
  if (node.actions) push(JSON.stringify(node.actions));

  // denormalized workflow behavior
  for (const summary of workflowSummaries) {
    push(summary);
  }


  // _shared component instance — include component model id and display name
  const shared = node._shared as Record<string, unknown> | undefined;
  if (shared) {
    if (shared.id) push(`_shared:${shared.id as string}`);
    if (shared.name) push(shared.name as string);
    push(JSON.stringify(shared));
  }

  // responsive breakpoint overrides — include all breakpoint keys and their class/style overrides
  if (node.responsive) push(JSON.stringify(node.responsive));

  // _validation rules (form field validation)
  if (node._validation) push(JSON.stringify(node._validation));

  const raw = parts.join(' ');
  return expandTheme(raw, theme);
}

/** Walk a node tree, emitting one entity per node (children not in the blob). */
function walkNodes(
  nodes: RawNode[],
  filePath: string,
  rawContent: string,
  nodePath: string,
  workflowMap: Map<string, { name?: string; description?: string }>,
  theme: Record<string, string>,
  out: Entity[],
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || typeof node !== 'object') continue;

    const nPath = `${nodePath}[${i}]`;
    const key = `${filePath}#${nPath}`;

    // Resolve workflow summaries for this node's actions
    const workflowSummaries: string[] = [];
    const actions = node.actions;
    if (actions) {
      const actionList = Array.isArray(actions) ? actions : Object.values(actions);
      for (const action of actionList.flat()) {
        if (!action || typeof action !== 'object') continue;
        const a = action as Record<string, unknown>;
        // Standard SDUI format: { "action": "workflow-id" }
        // Also support legacy formats just in case
        const wfId = (a.action ?? a.workflowId ?? a.workflow ?? a.id) as string | undefined;
        if (wfId) {
          const wf = workflowMap.get(wfId);
          if (wf) {
            const parts = [wf.name, wf.description].filter(Boolean).join(' ');
            if (parts) workflowSummaries.push(parts);
          }
        }
      }
    }

    const blob = buildNodeBlob(node, workflowSummaries, theme);
    const name = node.name as string | undefined;
    const type = node.type as string | undefined;
    const hasGroup = typeof node._group === 'string' && node._group.length > 0;
    const meaningful = !!(name || hasGroup);

    out.push({
      key,
      path: filePath,
      line: findNodeLine(rawContent, node),
      name,
      type,
      kind: 'node',
      blob,
      meaningful,
    });

    // Recurse into children
    const children = node.children as RawNode[] | undefined;
    if (Array.isArray(children) && children.length > 0) {
      walkNodes(children, filePath, rawContent, `${nPath}.children`, workflowMap, theme, out);
    }
  }
}

// ─── File-kind classification ─────────────────────────────────────────────────

function classifyPath(p: string): EntityKind {
  if (p.startsWith('store/')) return 'store';
  if (p.startsWith('workflows/') || p.match(/^pages\/[^/]+\/workflows\//)) return 'workflow';
  if (p.match(/^pages\/[^/]+\/triggers\//) || p.startsWith('triggers/')) return 'trigger';
  if (p.startsWith('data/')) return 'datasource';
  if (p.startsWith('utils/') || p.startsWith('formulas/')) return 'formula';
  if (p.startsWith('components/') && p.endsWith('/component')) return 'component';
  if (p === 'design/theme' || p.startsWith('design/')) return 'theme';
  if (p === 'routes') return 'routes';
  return 'resource';
}

function isNodeBearingPath(p: string): boolean {
  // pages/<name>/page, pages/<name>/groups/<group>
  // components/<id>/component (2-level) OR components/<folder>/<id>/component (3-level)
  return (
    /^pages\/[^/]+\/page$/.test(p) ||
    /^pages\/[^/]+\/groups\/[^/]+$/.test(p) ||
    (p.startsWith('components/') && p.endsWith('/component'))
  );
}

// ─── Workflow map builder ─────────────────────────────────────────────────────

function buildWorkflowMap(files: Record<string, string>): Map<string, { name?: string; description?: string }> {
  const map = new Map<string, { name?: string; description?: string }>();
  for (const [p, content] of Object.entries(files)) {
    if (!p.startsWith('workflows/') && !p.match(/^pages\/[^/]+\/workflows\//)) continue;
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const meta = parsed.meta as Record<string, unknown> | undefined;
      // Name is in meta.name (primary) or top-level name (legacy)
      const name = (meta?.name ?? parsed.name) as string | undefined;
      // Description at top-level or in meta
      const description = (parsed.description ?? meta?.description) as string | undefined;
      const id = (parsed.id ?? p.split('/').pop()) as string | undefined;
      if (id) map.set(id, { name, description });
      // Also index by file-path last segment so { "action": "toggle-status" } resolves
      // even when the parsed id differs
      const segment = p.split('/').pop();
      if (segment && segment !== id) map.set(segment, { name, description });
    } catch { /* skip malformed */ }
  }
  return map;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract all entities from a VFS files snapshot.
 *
 * @param files  Record<vfsPath, jsonString> — the full VFS state
 * @param theme  Record<colorKey, hex> — theme token map (from design/theme file)
 */
export function extractEntities(
  files: Record<string, string>,
  theme: Record<string, string> = {},
): Entity[] {
  const out: Entity[] = [];
  const workflowMap = buildWorkflowMap(files);

  for (const [filePath, rawContent] of Object.entries(files)) {
    if (isNodeBearingPath(filePath)) {
      // Parse the node tree and emit per-node entities
      try {
        const parsed = JSON.parse(rawContent) as Record<string, unknown>;
        // Support { "ui": [...] } (page files) and bare arrays/objects (group files)
        let rootNodes: RawNode[];
        if (Array.isArray(parsed)) {
          rootNodes = parsed as RawNode[];
        } else if (Array.isArray(parsed.ui)) {
          rootNodes = parsed.ui as RawNode[];
        } else if (Array.isArray((parsed as Record<string, unknown>).content)) {
          rootNodes = (parsed as Record<string, unknown>).content as RawNode[];
        } else if ((parsed as Record<string, unknown>).content && typeof (parsed as Record<string, unknown>).content === 'object') {
          // content as a single root node object (real admin screens use this shape)
          rootNodes = [(parsed as Record<string, unknown>).content as RawNode];
        } else if ((parsed as Record<string, unknown>).structure && typeof (parsed as Record<string, unknown>).structure === 'object') {
          // structure field (used by layout files)
          rootNodes = [(parsed as Record<string, unknown>).structure as RawNode];
        } else if (parsed.type) {
          rootNodes = [parsed as RawNode];
        } else {
          rootNodes = [];
        }

        // Emit a resource entity for screen-level metadata (layout, dataSources, etc.)
        // so these fields are searchable even though nodes are emitted per-node.
        const screenMeta: Record<string, unknown> = {};
        if ((parsed as Record<string, unknown>).layout) screenMeta.layout = (parsed as Record<string, unknown>).layout;
        if ((parsed as Record<string, unknown>).dataSources) screenMeta.dataSources = (parsed as Record<string, unknown>).dataSources;
        if ((parsed as Record<string, unknown>).meta) screenMeta.meta = (parsed as Record<string, unknown>).meta;
        if ((parsed as Record<string, unknown>).triggers) screenMeta.triggers = (parsed as Record<string, unknown>).triggers;
        if ((parsed as Record<string, unknown>).state) screenMeta.state = (parsed as Record<string, unknown>).state;
        if ((parsed as Record<string, unknown>).queryParams) screenMeta.queryParams = (parsed as Record<string, unknown>).queryParams;
        if (Object.keys(screenMeta).length > 0) {
          out.push({
            key: `${filePath}#screen-meta`,
            path: filePath,
            line: 1,
            name: filePath.split('/').pop(),
            kind: 'page',
            blob: expandTheme(JSON.stringify(screenMeta), theme),
            meaningful: true,
          });
        }

        // Emit a resource entity for component-level metadata (id, name, properties)
        // so shared-component model fields are searchable alongside their content nodes.
        if (filePath.endsWith('/component') && filePath.startsWith('components/')) {
          const compMeta: Record<string, unknown> = {};
          if ((parsed as Record<string, unknown>).id) compMeta.id = (parsed as Record<string, unknown>).id;
          if ((parsed as Record<string, unknown>).name) compMeta.name = (parsed as Record<string, unknown>).name;
          if ((parsed as Record<string, unknown>).properties) compMeta.properties = (parsed as Record<string, unknown>).properties;
          if (Object.keys(compMeta).length > 0) {
            out.push({
              key: `${filePath}#component-meta`,
              path: filePath,
              line: 1,
              name: (compMeta.name ?? filePath.split('/').pop()) as string | undefined,
              kind: 'component',
              blob: expandTheme(JSON.stringify(compMeta), theme),
              meaningful: true,
            });
          }
        }

        walkNodes(rootNodes, filePath, rawContent, 'root', workflowMap, theme, out);
      } catch { /* skip malformed */ }
    } else {
      // Emit one entity for the whole resource file
      const kind = classifyPath(filePath);
      const blob = expandTheme(rawContent, theme);
      // Try to extract a name for display
      let name: string | undefined;
      try {
        const parsed = JSON.parse(rawContent) as Record<string, unknown>;
        name = (parsed.name ?? parsed.id ?? filePath.split('/').pop()) as string | undefined;
      } catch {
        name = filePath.split('/').pop();
      }
      out.push({
        key: filePath,
        path: filePath,
        line: 1,
        name,
        kind,
        blob,
        meaningful: true,
      });
    }
  }

  return out;
}

/**
 * Parse the theme token map from the design/theme VFS file.
 * Returns {} if the file is missing or malformed.
 */
export function parseTheme(files: Record<string, string>): Record<string, string> {
  const raw = files['design/theme'];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}
