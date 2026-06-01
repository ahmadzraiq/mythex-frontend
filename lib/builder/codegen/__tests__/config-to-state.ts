/**
 * config-to-state.ts
 *
 * Adapter that converts the static config/ directory into a BuilderStore-shaped
 * object so the codegen pipeline can run against the real demo app config.
 *
 * This mirrors what the builder does at runtime when it calls loadFromConfig().
 */

import * as fs from 'fs';
import * as path from 'path';
import variablesJson from '@/config/variables.json';
import datasourcesJson from '@/config/datasources.json';
import routesJson from '@/config/routes.json';
import customColorsJson from '@/config/custom-colors.json';
import themeJson from '@/config/theme.json';
import root from '@/config/root';
import { resolveScreenConfig } from '@/lib/sdui/config-resolver';
import type { ConfigRegistry } from '@/lib/sdui/config-resolver';

import type { BuilderStore, CustomVar, DataSourceConfig } from '@/app/dev/builder/_store-types';
import type { SDUINode } from '@/lib/sdui/types/node';

// Registry matches what the builder uses in _store.ts (_fragmentRegistry)
const _registry: ConfigRegistry = {
  layouts: root.layouts as ConfigRegistry['layouts'],
  fragments: (root.fragments ?? {}) as ConfigRegistry['fragments'],
};

type VariablesDef = {
  variables?: Record<string, {
    label?: string;
    type?: string;
    initialValue?: unknown;
    saveInLocalStorage?: boolean;
    folder?: string;
  }>;
};

type DataSourcesDef = Record<string, {
  label?: string;
  name?: string;
  type?: 'rest' | 'graphql';
  url?: string;
  endpoint?: string;
  query?: string;
  method?: string;
  storeIn?: string;
  responsePath?: string;
  headers?: Record<string, string> | Array<{ key: string; value: string; enabled?: boolean }>;
  variables?: Record<string, unknown>;
  proxy?: boolean;
  sendCredentials?: boolean;
}>;

type RoutesDef = {
  defaultRedirect?: string;
  routes?: Array<{
    path: string;
    config?: string;
    auth?: boolean;
    layout?: string;
    paramChangeAction?: string;
    guestOnly?: boolean;
  }>;
};

const CONFIG_DIR = path.resolve(process.cwd(), 'config');
const SCREENS_DIR = path.join(CONFIG_DIR, 'screens');
const ACTIONS_DIR = path.join(CONFIG_DIR, 'actions');

// ── File lookup helpers ────────────────────────────────────────────────────────

/** Normalize a name to all-lowercase-alphanumeric for fuzzy file matching */
function normalizeKey(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Build a map: normalizedName → absolute file path, for all JSON files in a dir */
function buildFileIndex(dir: string): Map<string, string> {
  const index = new Map<string, string>();
  if (!fs.existsSync(dir)) return index;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const name = f.replace(/\.json$/, '');
    index.set(normalizeKey(name), path.join(dir, f));
  }
  return index;
}

const screensIndex = buildFileIndex(SCREENS_DIR);
const actionsIndex = buildFileIndex(ACTIONS_DIR);

function findScreenFile(configName: string): string | undefined {
  return screensIndex.get(normalizeKey(configName));
}

function findActionsFile(configName: string): string | undefined {
  return actionsIndex.get(normalizeKey(configName));
}

// ── Screen → SDUINode[] ────────────────────────────────────────────────────────

function loadScreenNodes(configName: string): SDUINode[] {
  const file = findScreenFile(configName);
  if (!file) return [];

  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;

  // Apply layout composition (e.g. "layout": "store" injects navbar/footer via $slot),
  // exactly as the builder does via resolveScreenConfig in _store.ts.
  const resolved = resolveScreenConfig(
    raw as Parameters<typeof resolveScreenConfig>[0],
    _registry,
  );

  const rootNode = (resolved.ui ?? resolved.content) as SDUINode | null | undefined;
  if (!rootNode || typeof rootNode !== 'object') return [];

  return [rootNode];
}

// ── Actions file → resolved workflows ─────────────────────────────────────────

type RawAction = Record<string, unknown>;
type RawWorkflow = {
  id?: string;
  name?: string;
  trigger?: string;
  steps?: Array<{ id?: string; action?: string; [k: string]: unknown }>;
};

/**
 * Load an actions JSON file and return:
 *  - `workflows`: Record<workflowId, resolvedSteps[]>
 *  - `workflowMeta`: Record<workflowId, { name, trigger }>
 *  - `workflowIds`: all workflow IDs defined in this config file (for domain grouping in codegen)
 */
function loadActions(configName: string): {
  workflows: Record<string, object[]>;
  workflowMeta: Record<string, { name: string; trigger: string }>;
  workflowIds: string[];
} {
  const file = findActionsFile(configName);
  if (!file) return { workflows: {}, workflowMeta: {}, workflowIds: [] };

  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;

  // Separate atomic actions (have `type`) from workflows (have `steps`)
  const atomicActions: Record<string, RawAction> = {};
  const rawWorkflows: Record<string, RawWorkflow> = {};

  for (const [id, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as RawAction;
    if (Array.isArray(e.steps)) {
      rawWorkflows[id] = e as RawWorkflow;
    } else if (typeof e.type === 'string') {
      atomicActions[id] = e;
    }
  }

  const workflows: Record<string, object[]> = {};
  const workflowMeta: Record<string, { name: string; trigger: string }> = {};

  // Recursively resolve action references in a step tree (including trueBranch, falseBranch,
  // branches, forEach steps, etc.) so nested action IDs get their type/config merged in.
  function resolveStepTree(step: Record<string, unknown>): Record<string, unknown> {
    const actionId = step.action as string | undefined;
    const actionDef = (actionId && atomicActions[actionId]) ? atomicActions[actionId] : {};
    const resolved = { ...actionDef, ...step } as Record<string, unknown>;
    // Normalize: wrap root-level params into `config` when the step has a type but no config
    if (typeof resolved.type === 'string' && !resolved.config) {
      const { id, type, name, action, trigger, trueBranch, falseBranch, branches, steps: _steps, ...rest } = resolved;
      resolved.config = rest;
      (resolved as Record<string, unknown>).id = id;
      (resolved as Record<string, unknown>).type = type;
      (resolved as Record<string, unknown>).name = name;
      (resolved as Record<string, unknown>).action = action;
      if (trueBranch !== undefined) (resolved as Record<string, unknown>).trueBranch = trueBranch;
      if (falseBranch !== undefined) (resolved as Record<string, unknown>).falseBranch = falseBranch;
      if (branches !== undefined) (resolved as Record<string, unknown>).branches = branches;
      if (_steps !== undefined) (resolved as Record<string, unknown>).steps = _steps;
    }
    // Recurse into nested step arrays
    for (const key of ['trueBranch', 'falseBranch', 'steps'] as const) {
      const nested = resolved[key];
      if (Array.isArray(nested)) {
        resolved[key] = nested.map(s => resolveStepTree(s as Record<string, unknown>));
      }
    }
    if (Array.isArray(resolved.branches)) {
      resolved.branches = (resolved.branches as Record<string, unknown>[]).map(b => ({
        ...b,
        steps: Array.isArray(b.steps)
          ? (b.steps as Record<string, unknown>[]).map(s => resolveStepTree(s))
          : b.steps,
      }));
    }
    return resolved;
  }

  for (const [wfId, wf] of Object.entries(rawWorkflows)) {
    const resolvedSteps = (wf.steps ?? []).map(step => resolveStepTree(step));

    workflows[wfId] = resolvedSteps;
    workflowMeta[wfId] = {
      name: wf.name ?? wfId,
      trigger: wf.trigger ?? 'click',
    };
  }

  // Also register standalone atomic actions as single-step workflows.
  // Nodes can reference atomic action IDs directly (without a parent workflow).
  for (const [id, action] of Object.entries(atomicActions)) {
    if (workflows[id]) continue; // already registered (shouldn't happen but guard)
    const { name, trigger, ...stepFields } = action as Record<string, unknown>;
    workflows[id] = [{ ...stepFields, id }];
    workflowMeta[id] = {
      name: String(name ?? id),
      trigger: String(trigger ?? 'click'),
    };
  }

  return { workflows, workflowMeta, workflowIds: Object.keys(workflows) };
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Convert the static config/ JSON files into a minimal BuilderStore
 * that the codegen pipeline can process.
 */
export function configToBuilderState(): Partial<BuilderStore> & Pick<BuilderStore, 'pages' | 'customVars' | 'pageDataSources'> {
  // ── Variables ──────────────────────────────────────────────────────────────
  const varsRaw = (variablesJson as VariablesDef).variables ?? {};
  const customVars: CustomVar[] = Object.entries(varsRaw).map(([uuid, def]) => ({
    id: uuid,
    name: def.label ?? uuid,
    type: (def.type as CustomVar['type']) ?? 'string',
    initialValue: def.initialValue,
    saveInLocalStorage: def.saveInLocalStorage ?? false,
  }));

  // ── Datasources ────────────────────────────────────────────────────────────
  const dsRaw = datasourcesJson as DataSourcesDef;
  const pageDataSources: DataSourceConfig[] = Object.entries(dsRaw).map(([uuid, def]) => {
    // Normalize headers: datasources.json stores them as a plain { key: value } object,
    // but DataSourceConfig expects DataSourceHeader[] ({ key, value, enabled? }[]).
    const rawH = def.headers;
    const headers = Array.isArray(rawH)
      ? rawH as import('@/app/dev/builder/_store-types').DataSourceHeader[]
      : rawH && typeof rawH === 'object'
        ? Object.entries(rawH as Record<string, string>).map(([k, v]) => ({ key: k, value: v, enabled: true }))
        : [];

    return {
      id: uuid,
      _label: def.label ?? def.name ?? uuid,
      name: def.name ?? uuid,
      type: def.type ?? 'rest',
      url: def.url,
      endpoint: def.endpoint,
      query: def.query,
      method: (def.method as DataSourceConfig['method']) ?? 'GET',
      storeIn: def.storeIn ?? `collections.${uuid}`,
      responsePath: def.responsePath,
      variables: def.variables as Record<string, unknown> | undefined,
      proxy: def.proxy,
      sendCredentials: def.sendCredentials,
      headers,
    };
  });

  // ── Pages (with actual node trees) ────────────────────────────────────────
  const routesDef = routesJson as RoutesDef;
  const pages = (routesDef.routes ?? []).map((r) => {
    const cfg = r.config ?? '';
    const nodes = loadScreenNodes(cfg);
    return {
      id: r.path.replace(/\//g, '-').replace(/^-/, '') || 'home',
      name: cfg || r.path,
      route: r.path,
      nodes,
      meta: {
        isProtected: r.auth === true,
        guestOnly: r.guestOnly === true,
      },
    };
  });

  // ── Workflows ─────────────────────────────────────────────────────────────
  // Load ALL action files: shared layout/cart/auth/etc. files PLUS per-page
  // files. Shared files (e.g. layout.json) hold the navbar/footer workflows
  // referenced by every page that uses the store layout.
  const pageWorkflows: Record<string, object[]> = {};
  const pageWorkflowMeta: Record<string, { name: string; trigger: string }> = {};
  // Groups workflows by source config filename so codegen can split into domain files.
  const pageWorkflowGroups: Record<string, string[]> = {};

  // 1. Shared / non-route action files first (so per-page entries can override)
  const routeConfigs = new Set((routesDef.routes ?? []).map(r => normalizeKey(r.config ?? '')));
  for (const [normalizedName, filePath] of actionsIndex) {
    if (routeConfigs.has(normalizedName)) continue; // handled in step 2
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const configName = path.basename(filePath, '.json');
    const { workflows, workflowMeta, workflowIds } = loadActions(configName);
    void raw;
    Object.assign(pageWorkflows, workflows);
    Object.assign(pageWorkflowMeta, workflowMeta);
    if (workflowIds.length > 0) {
      pageWorkflowGroups[configName] = [...(pageWorkflowGroups[configName] ?? []), ...workflowIds];
    }
  }

  // 2. Per-route action files
  for (const r of routesDef.routes ?? []) {
    const cfg = r.config ?? '';
    const { workflows, workflowMeta, workflowIds } = loadActions(cfg);
    Object.assign(pageWorkflows, workflows);
    Object.assign(pageWorkflowMeta, workflowMeta);
    if (workflowIds.length > 0) {
      pageWorkflowGroups[cfg] = [...(pageWorkflowGroups[cfg] ?? []), ...workflowIds];
    }
  }

  // ── Theme ──────────────────────────────────────────────────────────────────
  const themeRaw = themeJson as Record<string, unknown>;

  // ── Custom Colors ──────────────────────────────────────────────────────────
  type ColorDef = { name: string; light: string; dark: string };
  const colorsRaw = (customColorsJson as { customColors?: ColorDef[]; colors?: ColorDef[] }).customColors
    ?? (customColorsJson as { colors?: ColorDef[] }).colors
    ?? [];
  const customColors = colorsRaw.map(c => ({
    id: c.name,
    name: c.name,
    light: c.light ?? '#ffffff',
    dark: c.dark ?? '#000000',
  }));

  // ── Auth config (synthesized from routes.json if protected routes exist) ───
  const protectedRoutes = (routesDef.routes ?? []).filter(r => r.auth === true);
  const syntheticAuthConfig = protectedRoutes.length > 0 ? {
    unauthenticatedRedirect: routesDef.defaultRedirect ?? '/sign-in',
  } : undefined;

  return {
    pages,
    customVars,
    pageDataSources,
    customColors,
    themeOverrides: (themeRaw.overrides as Record<string, string>) ?? {},
    themeDarkOverrides: (themeRaw.darkOverrides as Record<string, string>) ?? {},
    pageWorkflows,
    globalWorkflows: {},
    pageWorkflowMeta,
    pageWorkflowGroups,
    globalWorkflowMeta: {},
    authConfig: syntheticAuthConfig,
  };
}
