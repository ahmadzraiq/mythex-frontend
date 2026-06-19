/**
 * Seed a builder project from the local config files (config/root.ts).
 *
 * Converts the static JSON configs into the builder state blob that the
 * backend stores in Project.config (same format as serializeBuilderState).
 *
 * Pages     → one BuilderPage per screen in config/root.ts
 * Workflows → all named workflow actions (those with a steps array) from config/actions/*.json
 * Variables → config/variables.json
 * DataSrcs  → config/datasources.json
 * Theme     → config/theme.json color overrides
 */

import root from '@/config/root';
import { getBuilderConfig } from './config-data';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "camelCase" or "kebab-case" → "Camel Case" / "Kebab Case" */
function toLabel(s: string): string {
  return s
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, c => c.toUpperCase());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recursively ensure every node has a UUID `id`.
 * Static screen JSON (home.json, etc.) has no ids — the builder needs ids on
 * every node so it can stamp data-builder-id and make nodes selectable.
 * Existing UUID ids are preserved; anything else gets a fresh random UUID.
 */
function assignNodeIds(nodes: unknown[]): unknown[] {
  return nodes.map(n => {
    const node = n as Record<string, unknown>;
    const existing = node.id as string | undefined;
    const id = existing && UUID_RE.test(existing) ? existing : crypto.randomUUID();
    const children = Array.isArray(node.children) ? assignNodeIds(node.children) : node.children;
    return { ...node, id, children };
  });
}

// ── Build ─────────────────────────────────────────────────────────────────────

export function buildSeedConfig(): Record<string, unknown> {
  const builderCfg = getBuilderConfig();

  // Map screen config-name → route path  (e.g. "home" → "/")
  const rawRoutes = (root.routes as unknown as { routes?: Array<{ path: string; config?: string }> }).routes
    ?? (root.routes as unknown as Array<{ path: string; config?: string }>);
  const routeMap = new Map<string, string>(
    rawRoutes
      .filter(r => r.config)
      .map(r => [r.config!, r.path]),
  );

  // ── Pages from screens ────────────────────────────────────────────────────
  const pages = Object.entries(
    root.screens as Record<string, Record<string, unknown>>,
  ).map(([name, screen]) => {
    // Derive the route: prefer routes.json match, fall back to /kebab-name
    const route =
      routeMap.get(name) ??
      `/${name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')}`;

    // Use `content` (most screens) or `ui` (screens without layout)
    const raw = screen.content ?? screen.ui ?? null;
    const rawNodes: unknown[] = raw
      ? Array.isArray(raw) ? raw : [raw]
      : [];
    // Assign UUIDs to nodes that lack them — static screen JSONs have no ids,
    // but the builder requires an id on every node for selection to work.
    const nodes = assignNodeIds(rawNodes);

    return {
      id: `page-${name}`,
      name: toLabel(name),
      route,
      nodes,
    };
  });

  // ── Workflows from actions/*.json ─────────────────────────────────────────
  const workflows: Record<string, import('@/config/types').WorkflowDef> = {};
  for (const wf of builderCfg.workflows) {
    workflows[wf.id] = { id: wf.id, name: wf.name, trigger: wf.trigger, steps: wf.steps, params: wf.params as import('@/config/types').WorkflowParam[] | undefined };
  }

  // ── Shared component workflows (so executeComponentAction's picker finds them) ─
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharedComponents = require('@/config/shared-components.json') as Record<string, {
      name?: string;
      workflows?: Record<string, { trigger: string; steps: unknown[]; name?: string }>;
    }>;
    for (const [scId, scModel] of Object.entries(sharedComponents)) {
      const scName = scModel.name ?? scId;
      for (const [wfId, wf] of Object.entries(scModel.workflows ?? {})) {
        if (!workflows[wfId]) {
          const wfName = `${scName} — ${wf.name ?? wfId}`;
          workflows[wfId] = { id: wfId, name: wfName, trigger: wf.trigger, steps: (wf.steps as object[]) ?? [] };
        }
      }
    }
  } catch { /* no shared components registered */ }

  // ── Variables from config/variables.json ─────────────────────────────────
  const customVars = builderCfg.variables.map(v => ({
    id: v.id,
    name: v.id,
    label: (v as { label?: string }).label ?? v.id,
    type: (v as { type?: string }).type ?? 'string',
    initialValue: (v as { initialValue?: unknown }).initialValue,
    folderId: (v as { folder?: string }).folder,
    fields: (v as { fields?: unknown }).fields,
  }));
  const varFolders = builderCfg.varFolders.map(f => ({
    id: f.id,
    name: f.label,
    parentId: undefined as string | undefined,
  }));

  // ── Data sources from config/datasources.json ─────────────────────────────
  const pageDataSources = builderCfg.dataSources;
  const dsFolders = builderCfg.dsFolders;

  // ── Theme from config/theme.json ──────────────────────────────────────────
  const themeOverrides: Record<string, string> = {};
  const themeDarkOverrides: Record<string, string> = {};
  const theme = root.theme as Record<string, unknown>;

  // theme.json stores colors either at the root or under a "colors" key
  const colorSource =
    (theme.colors as Record<string, string> | undefined) ??
    (theme as Record<string, string>);

  for (const [k, v] of Object.entries(colorSource)) {
    if (typeof v === 'string') themeOverrides[k] = v;
  }

  return {
    pages,
    workflows,
    customVars,
    varFolders,
    pageDataSources,
    dsFolders,
    themeOverrides,
    themeDarkOverrides,
  };
}
