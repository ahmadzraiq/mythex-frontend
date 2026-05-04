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

import type { BuilderStore, CustomVar, DataSourceConfig } from '@/app/dev/builder/_store-types';
import type { SDUINode } from '@/lib/sdui/types/node';

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

  // Root may be under 'ui' or 'content'
  const rootNode = (raw.ui ?? raw.content) as SDUINode | null | undefined;
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
 */
function loadActions(configName: string): {
  workflows: Record<string, object[]>;
  workflowMeta: Record<string, { name: string; trigger: string }>;
} {
  const file = findActionsFile(configName);
  if (!file) return { workflows: {}, workflowMeta: {} };

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

  for (const [wfId, wf] of Object.entries(rawWorkflows)) {
    const resolvedSteps: object[] = [];

    for (const step of wf.steps ?? []) {
      const actionId = step.action;
      const actionDef = (actionId && atomicActions[actionId]) ? atomicActions[actionId] : {};
      // Merge: step fields take precedence over action definition,
      // except we use the action's `type`/`config` when the step doesn't override them
      const resolved = { ...actionDef, ...step };
      // Normalize: the codegen emitStep() looks for `type` and `config`
      // Many actions store their params at root level — wrap them in `config`
      if (typeof resolved.type === 'string' && !resolved.config) {
        const { id, type, name, action, trigger, ...rest } = resolved as Record<string, unknown>;
        resolved.config = rest;
        // Re-attach non-config fields
        (resolved as Record<string, unknown>).id = id;
        (resolved as Record<string, unknown>).type = type;
        (resolved as Record<string, unknown>).name = name;
        (resolved as Record<string, unknown>).action = action;
      }
      resolvedSteps.push(resolved);
    }

    workflows[wfId] = resolvedSteps;
    workflowMeta[wfId] = {
      name: wf.name ?? wfId,
      trigger: wf.trigger ?? 'click',
    };
  }

  return { workflows, workflowMeta };
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
  const pageDataSources: DataSourceConfig[] = Object.entries(dsRaw).map(([uuid, def]) => ({
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
    headers: [],
  }));

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
      meta: undefined,
    };
  });

  // ── Workflows (from per-page action files) ────────────────────────────────
  const pageWorkflows: Record<string, object[]> = {};
  const pageWorkflowMeta: Record<string, { name: string; trigger: string }> = {};

  for (const r of routesDef.routes ?? []) {
    const cfg = r.config ?? '';
    const { workflows, workflowMeta } = loadActions(cfg);
    Object.assign(pageWorkflows, workflows);
    Object.assign(pageWorkflowMeta, workflowMeta);
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
    globalWorkflowMeta: {},
  };
}
