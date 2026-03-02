/**
 * /api/builder/config
 *
 * GET  — reads config/actions/*.json + config/store.json and returns structured
 *         data for the builder panels (Data Sources, Workflows, Variables, Formulas).
 *
 * PUT  — accepts the same structure and writes changes back to the config files.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const ACTIONS_DIR = path.join(CONFIG_DIR, 'actions');
const STORE_PATH = path.join(CONFIG_DIR, 'store.json');

// ─── Types (mirrors _store.ts, duplicated here to avoid importing client code) ─

interface DataSourceConfig {
  id: string;
  name: string;
  type: 'rest' | 'graphql';
  url?: string;
  method?: string;
  headers?: Array<{ key: string; value: string; enabled: boolean }>;
  body?: string;
  queryParams?: Array<{ key: string; value: string; enabled: boolean }>;
  auth?: Record<string, unknown>;
  endpoint?: string;
  query?: string;
  variables?: string;
  storeIn?: string;
  responsePath?: string;
  trigger?: 'mount' | 'action';
  triggerActionName?: string;
  _sourceFile?: string;
}

interface CustomVar {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  initialValue: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/** Load all action files, return Map<filename-without-ext, actionRecord> */
function loadAllActions(): Map<string, Record<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, Record<string, unknown>>>();
  const files = fs.readdirSync(ACTIONS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const name = file.replace('.json', '');
    map.set(name, readJson(path.join(ACTIONS_DIR, file)));
  }
  return map;
}

/** Convert a graphql/fetch action entry to DataSourceConfig */
function actionToDataSource(
  actionName: string,
  action: Record<string, unknown>,
  sourceFile: string,
): DataSourceConfig {
  const type = action.type === 'graphql' ? 'graphql' : 'rest';
  const cfg: DataSourceConfig = {
    id: actionName,
    name: actionName,
    type,
    _sourceFile: sourceFile,
  };

  if (type === 'graphql') {
    cfg.endpoint = (action.endpoint as string | undefined) ?? '';
    cfg.query = (action.query as string | undefined) ?? '';
    const vars = action.variables;
    if (vars !== undefined) {
      cfg.variables = typeof vars === 'string' ? vars : JSON.stringify(vars, null, 2);
    }
  } else {
    cfg.url = (action.url as string | undefined) ?? '';
    cfg.method = ((action.method as string | undefined) ?? 'GET') as DataSourceConfig['method'];
    const qp = action.queryParams;
    if (Array.isArray(qp)) {
      cfg.queryParams = qp as DataSourceConfig['queryParams'];
    }
  }

  // Headers — stored in actions as Record<string,unknown> but builder uses array
  const rawHeaders = action.headers;
  if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
    cfg.headers = Object.entries(rawHeaders as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      value: typeof v === 'string' ? v : JSON.stringify(v),
      enabled: true,
    }));
  } else if (Array.isArray(rawHeaders)) {
    cfg.headers = rawHeaders as DataSourceConfig['headers'];
  }

  cfg.storeIn = (action.storeIn as string | undefined) ?? '';
  cfg.responsePath = (action.responsePath as string | undefined) ?? '';
  cfg.trigger = 'mount';

  return cfg;
}

/** Convert a non-graphql/fetch action entry to a single-step workflow array */
function actionToWorkflowSteps(
  actionName: string,
  action: Record<string, unknown>,
): object[] {
  // Wrap the raw action definition as a single "named call" step
  return [{ ...action, _actionName: actionName }];
}

/** Convert store.json initialData to CustomVar array */
function initialDataToVars(initialData: Record<string, unknown>): CustomVar[] {
  return Object.entries(initialData)
    .filter(([key]) => !key.startsWith('_')) // skip internal _workflow etc.
    .map(([key, value]) => {
      let type: CustomVar['type'] = 'string';
      let initialValue = '';
      if (value === null || value === undefined) {
        type = 'string';
        initialValue = '';
      } else if (typeof value === 'boolean') {
        type = 'boolean';
        initialValue = String(value);
      } else if (typeof value === 'number') {
        type = 'number';
        initialValue = String(value);
      } else if (Array.isArray(value)) {
        type = 'array';
        initialValue = JSON.stringify(value, null, 2);
      } else if (typeof value === 'object') {
        type = 'object';
        initialValue = JSON.stringify(value, null, 2);
      } else {
        type = 'string';
        initialValue = String(value);
      }
      return { name: key, type, initialValue };
    });
}

/** Convert store.json computed[] to formulas record */
function computedToFormulas(
  computed: Array<{ output: string; expr: object }>,
): Record<string, object> {
  const result: Record<string, object> = {};
  for (const entry of computed ?? []) {
    if (entry.output && entry.expr) {
      result[entry.output] = entry.expr;
    }
  }
  return result;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const allActions = loadAllActions();
    const storeJson = readJson<{
      initialData?: Record<string, unknown>;
      computed?: Array<{ output: string; expr: object }>;
      engineConventions?: {
        graphqlEndpoint?: string;
        graphqlHeaders?: Record<string, string>;
        graphqlCredentials?: string;
      };
    }>(STORE_PATH);

    const conventions = storeJson.engineConventions ?? {};
    const globalEndpoint = conventions.graphqlEndpoint ?? '';
    const globalGqlHeaders = conventions.graphqlHeaders ?? {};

    const dataSources: DataSourceConfig[] = [];
    const workflows: Record<string, object[]> = {};

    for (const [fileName, actions] of allActions) {
      for (const [actionName, action] of Object.entries(actions)) {
        const t = action.type as string | undefined;
        if (t === 'graphql' || t === 'fetch') {
          const ds = actionToDataSource(actionName, action, fileName);
          // If the action has no explicit endpoint, inherit the global one
          if (t === 'graphql' && !ds.endpoint) {
            ds.endpoint = globalEndpoint;
          }
          // Merge global GraphQL headers (action-level headers take priority)
          if (t === 'graphql' && Object.keys(globalGqlHeaders).length) {
            const existing = ds.headers ?? [];
            const existingKeys = new Set(existing.map(h => h.key));
            const merged = [
              ...existing,
              ...Object.entries(globalGqlHeaders)
                .filter(([k]) => !existingKeys.has(k))
                .map(([k, v]) => ({ key: k, value: v, enabled: true })),
            ];
            ds.headers = merged;
          }
          dataSources.push(ds);
        } else {
          // All other actions become single-step workflows
          workflows[actionName] = actionToWorkflowSteps(actionName, action);
        }
      }
    }

    const variables = initialDataToVars(storeJson.initialData ?? {});
    const formulas = computedToFormulas(storeJson.computed ?? []);

    return NextResponse.json({
      dataSources,
      workflows,
      variables,
      formulas,
      engineConventions: {
        graphqlEndpoint: globalEndpoint,
        graphqlHeaders: globalGqlHeaders,
        graphqlCredentials: conventions.graphqlCredentials,
      },
    });
  } catch (err) {
    console.error('[builder/config GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      dataSources?: DataSourceConfig[];
      workflows?: Record<string, object[]>;
      variables?: CustomVar[];
      formulas?: Record<string, object>;
    };

    // ── Write back Data Sources & Workflows to action files ──────────────────

    const allActions = loadAllActions();

    // Group changes by source file
    const pendingActionFiles = new Map<string, Record<string, Record<string, unknown>>>();

    // Initialize from current file state
    for (const [fileName, actions] of allActions) {
      pendingActionFiles.set(fileName, { ...actions });
    }

    // Apply data source changes
    for (const ds of body.dataSources ?? []) {
      const fileKey = ds._sourceFile ?? 'products';
      if (!pendingActionFiles.has(fileKey)) {
        pendingActionFiles.set(fileKey, {});
      }
      const fileActions = pendingActionFiles.get(fileKey)!;

      // Rebuild the action object from the DataSourceConfig
      const actionObj: Record<string, unknown> = {};
      actionObj.type = ds.type === 'graphql' ? 'graphql' : 'fetch';

      if (ds.type === 'graphql') {
        if (ds.endpoint) actionObj.endpoint = ds.endpoint;
        if (ds.query) actionObj.query = ds.query;
        if (ds.variables) {
          try { actionObj.variables = JSON.parse(ds.variables); }
          catch { actionObj.variables = ds.variables; }
        }
      } else {
        if (ds.url) actionObj.url = ds.url;
        if (ds.method) actionObj.method = ds.method;
        if (ds.queryParams?.length) actionObj.queryParams = ds.queryParams;
      }

      // Headers — convert back to Record
      if (ds.headers?.length) {
        const hdrs: Record<string, string> = {};
        for (const h of ds.headers.filter(h => h.enabled && h.key)) {
          hdrs[h.key] = h.value;
        }
        if (Object.keys(hdrs).length) actionObj.headers = hdrs;
      }

      if (ds.storeIn) actionObj.storeIn = ds.storeIn;
      if (ds.responsePath) actionObj.responsePath = ds.responsePath;

      // Preserve other fields that were already on the action (cacheTag, etc.)
      const existing = fileActions[ds.name] ?? fileActions[ds.id];
      if (existing) {
        const preserved = { ...existing, ...actionObj };
        fileActions[ds.name] = preserved;
        // Remove old key if name changed
        if (ds.id !== ds.name && fileActions[ds.id]) {
          delete fileActions[ds.id];
        }
      } else {
        fileActions[ds.name] = actionObj;
      }
    }

    // Apply workflow changes (non-graphql/fetch actions)
    for (const [wfName, steps] of Object.entries(body.workflows ?? {})) {
      // Find which file this came from, default to 'layout'
      let targetFile = 'layout';
      for (const [fileName, actions] of allActions) {
        if (actions[wfName]) { targetFile = fileName; break; }
      }
      if (!pendingActionFiles.has(targetFile)) {
        pendingActionFiles.set(targetFile, {});
      }
      const fileActions = pendingActionFiles.get(targetFile)!;

      if (steps.length === 1) {
        // Single-step: store as plain action (strip _actionName meta)
        const step = { ...(steps[0] as Record<string, unknown>) };
        delete step._actionName;
        fileActions[wfName] = step;
      } else if (steps.length > 1) {
        fileActions[wfName] = { type: 'runMultiple', actions: steps };
      }
      // steps.length === 0 → remove action
      else {
        delete fileActions[wfName];
      }
    }

    // Write action files
    for (const [fileName, actions] of pendingActionFiles) {
      const filePath = path.join(ACTIONS_DIR, `${fileName}.json`);
      writeJson(filePath, actions);
    }

    // ── Write back Variables & Formulas to store.json ────────────────────────

    if (body.variables !== undefined || body.formulas !== undefined) {
      const storeJson = readJson<Record<string, unknown>>(STORE_PATH);

      if (body.variables !== undefined) {
        const newInitialData: Record<string, unknown> = {};
        for (const v of body.variables) {
          try {
            if (v.type === 'object' || v.type === 'array') {
              newInitialData[v.name] = JSON.parse(v.initialValue);
            } else if (v.type === 'number') {
              newInitialData[v.name] = Number(v.initialValue);
            } else if (v.type === 'boolean') {
              newInitialData[v.name] = v.initialValue === 'true';
            } else {
              newInitialData[v.name] = v.initialValue;
            }
          } catch {
            newInitialData[v.name] = v.initialValue;
          }
        }
        // Preserve internal keys
        const existing = (storeJson.initialData ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(existing)) {
          if (k.startsWith('_') && !(k in newInitialData)) {
            newInitialData[k] = v;
          }
        }
        storeJson.initialData = newInitialData;
      }

      if (body.formulas !== undefined) {
        const computed: Array<{ output: string; expr: object }> = [];
        for (const [output, expr] of Object.entries(body.formulas)) {
          computed.push({ output, expr: expr as object });
        }
        storeJson.computed = computed;
      }

      writeJson(STORE_PATH, storeJson);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[builder/config PUT]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
