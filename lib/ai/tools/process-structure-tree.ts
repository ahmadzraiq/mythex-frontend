/**
 * Shared structure-tree processing helper.
 *
 * Extracted from the former runStructureAgent in route.ts so the smart
 * planner's generate_structure tool handler can call the same logic.
 *
 * Responsibilities:
 *  - assignTreeIds   — stamp valid hex UUIDs on every node
 *  - normalizeWorkflowId — normalise AI-generated workflow IDs
 *  - extractAndStripMarkers — pull loop/showIf hints off the tree before sending to client
 *  - variable UUID deduplication + varEvent building
 *  - CollectedTree assembly
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface CollectedTree {
  unitName: string;
  tree: Record<string, unknown>;
  pageId: string | null;
  atIndex?: number;
  structureHint?: string;
  pageActions?: Array<{ workflowId: string; trigger: string }>;
  mediaManifest?: {
    icons: Array<{ id: string; icon: string; name?: string }>;
    images: Array<{ id: string; searchQuery: string; name?: string }>;
    videos: Array<{ id: string; searchQuery: string; name?: string }>;
    bgImages: Array<{ id: string; searchQuery: string; name?: string }>;
  };
}

export interface ToolEvent {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

export type Marker = {
  nodeId: string;
  loop?: string | boolean;
  loopKey?: string;
  showIf?: string;
};

// ─── UUID helpers ─────────────────────────────────────────────────────────────

const TREE_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUUIDFormat(s: string): boolean {
  return TREE_UUID_RE.test(s);
}

export function normalizeWorkflowId(raw: string, wfIdMap: Map<string, string>): string {
  if (TREE_UUID_RE.test(raw)) return raw;
  if (!wfIdMap.has(raw)) wfIdMap.set(raw, crypto.randomUUID());
  return wfIdMap.get(raw)!;
}

// ─── Tree ID assignment ───────────────────────────────────────────────────────

export function assignTreeIds(
  node: Record<string, unknown>,
  seen: Set<string> = new Set(),
  wfIdMap: Map<string, string> = new Map(),
): Record<string, unknown> {
  const raw = typeof node.id === 'string' ? node.id : '';
  const id = TREE_UUID_RE.test(raw) && !seen.has(raw) ? raw : crypto.randomUUID();
  seen.add(id);

  if (Array.isArray(node.actions)) {
    (node.actions as Array<Record<string, unknown>>).forEach(act => {
      const wfRaw = typeof act.workflowId === 'string' ? act.workflowId : '';
      if (wfRaw) act.workflowId = normalizeWorkflowId(wfRaw, wfIdMap);
    });
  }

  const children = Array.isArray(node.children)
    ? (node.children as Record<string, unknown>[]).map(c => assignTreeIds(c, seen, wfIdMap))
    : [];
  const result: Record<string, unknown> = { ...node, id, children };
  if (result.condition === 'true' || result.condition === true) delete result.condition;
  // Auto-fix: Grid with repeat + single child → move repeat to the child
  const label = (result.label as string ?? '').toLowerCase();
  if (label === 'grid' && typeof result.repeat === 'string' && children.length === 1) {
    const child = children[0] as Record<string, unknown>;
    if (!child.repeat) {
      child.repeat = result.repeat;
      if (result.keyField) child.keyField = result.keyField;
      delete result.repeat;
      delete result.keyField;
    }
  }
  return result;
}

// ─── Marker extraction ────────────────────────────────────────────────────────

export function extractAndStripMarkers(tree: Record<string, unknown>): Marker[] {
  const markers: Marker[] = [];
  const walk = (node: Record<string, unknown>) => {
    const loop = node.loop;
    const loopKey = node.loopKey;
    const showIf = node.showIf;
    delete node.loop;
    delete node.loopKey;
    delete node.showIf;
    delete node.direction;
    if (loop || showIf) {
      markers.push({
        nodeId: node.id as string,
        loop: loop as string | boolean | undefined,
        loopKey: loopKey as string | undefined,
        showIf: showIf as string | undefined,
      });
    }
    for (const child of (Array.isArray(node.children) ? node.children as Record<string, unknown>[] : [])) {
      walk(child);
    }
  };
  walk(tree);
  return markers;
}

// ─── Main exported function ───────────────────────────────────────────────────

export interface ProcessStructureTreeInput {
  rawInput: Record<string, unknown>;
  unitName: string;
  assignedPageId: string | null;
  structureHint?: string;
  existingVariables: Array<{ id?: string; label?: string; name?: string; type?: string; initialValue?: unknown }>;
  emit: (event: Record<string, unknown>) => void;
  allExecutedTools: Array<{ name: string; input: Record<string, unknown>; result?: unknown }>;
}

export interface ProcessStructureTreeResult {
  collectedTree: CollectedTree;
  markers: Marker[];
  varEvents: ToolEvent[];
}

export function processStructureTree(opts: ProcessStructureTreeInput): ProcessStructureTreeResult | null {
  const { rawInput, unitName, assignedPageId, structureHint, existingVariables, emit, allExecutedTools } = opts;

  const treeInput = rawInput.tree as Record<string, unknown> | undefined | null;
  if (!treeInput || typeof treeInput !== 'object') return null;

  const atIndex = rawInput.atIndex as number | undefined;
  const wfIdMap = new Map<string, string>();
  const resolvedTree = assignTreeIds(treeInput, new Set(), wfIdMap);
  const markers = extractAndStripMarkers(resolvedTree);

  const rawPageActions = Array.isArray(rawInput.pageActions)
    ? (rawInput.pageActions as Array<{ workflowId?: string; trigger?: string }>)
        .filter((pa): pa is { workflowId: string; trigger: string } =>
          typeof pa.workflowId === 'string' && typeof pa.trigger === 'string')
        .map(pa => ({ ...pa, workflowId: normalizeWorkflowId(pa.workflowId, wfIdMap) }))
    : undefined;

  const collectedTree: CollectedTree = {
    unitName,
    tree: resolvedTree,
    pageId: assignedPageId,
    atIndex,
    structureHint,
    pageActions: rawPageActions?.length ? rawPageActions : undefined,
  };

  // ── Variable processing ──────────────────────────────────────────────────────
  const declaredVars = (Array.isArray(rawInput.variables) ? rawInput.variables : []) as Array<{
    name: string;
    type: string;
    initialValue?: unknown;
    uuid: string;
    description?: string;
    folder?: string;
    schema?: string;
    mediaHints?: Array<{ field: string; searchQuery?: string; queryField?: string }>;
  }>;

  const varEvents: ToolEvent[] = [];
  const batchAssignedIds = new Set<string>();

  for (const v of declaredVars) {
    const varName = String(v.name ?? 'variable');
    const requestedId = (v.uuid && isUUIDFormat(v.uuid)) ? v.uuid : null;

    // UUID drift guard: reuse by name+type, then honour requested if collision-free, else fresh UUID
    const sameNameVar = existingVariables.find(ev =>
      (ev.name === varName || ev.label === varName) && ev.type === v.type
    );
    let assignedId: string;
    if (sameNameVar?.id) {
      assignedId = sameNameVar.id;
    } else if (
      requestedId &&
      !existingVariables.some(ev => ev.id === requestedId) &&
      !batchAssignedIds.has(requestedId)
    ) {
      assignedId = requestedId;
    } else {
      assignedId = crypto.randomUUID();
    }
    batchAssignedIds.add(assignedId);

    const clientInput: Record<string, unknown> = {
      name: varName,
      type: v.type,
      initialValue: v.initialValue,
      variableId: assignedId,
      _assignedVarId: assignedId,
      description: v.description,
      folder: v.folder,
    };
    if (typeof v.schema === 'string' && v.schema.trim() !== '') clientInput.schema = v.schema.trim();
    const varMediaHints = Array.isArray(v.mediaHints)
      ? v.mediaHints.filter(h => typeof h.field === 'string' && (typeof h.searchQuery === 'string' || typeof h.queryField === 'string'))
      : [];
    if (varMediaHints.length > 0) clientInput.mediaHints = varMediaHints;

    varEvents.push({ name: 'add_variable', input: clientInput, result: { success: true } });
    emit({
      type: 'tool_executed',
      id: `var-${varName.replace(/[^a-zA-Z0-9_-]/g, '-')}-${assignedId.slice(0, 8)}`,
      name: 'add_variable',
      input: clientInput,
      phase: 'structure',
    });
    allExecutedTools.push({ name: 'add_variable', input: clientInput });
  }

  return { collectedTree, markers, varEvents };
}
