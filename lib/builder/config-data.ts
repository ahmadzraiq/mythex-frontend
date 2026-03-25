/**
 * Builder config data — pure client-side, no server required.
 *
 * Reads statically-imported JSON configs and returns the same shape that the
 * old /api/builder/config GET endpoint returned.  The `addVariable` helper
 * is also in-memory only (changes do not persist to disk).
 */

import dataSourcesJson from '@/config/datasources.json';
import variablesJson from '@/config/variables.json';
import authActions from '@/config/actions/auth.json';
import cartActions from '@/config/actions/cart.json';
import checkoutActions from '@/config/actions/checkout.json';
import accountActions from '@/config/actions/account.json';
import productsActions from '@/config/actions/products.json';
import layoutActions from '@/config/actions/layout.json';
import workflowTestActions from '@/config/actions/workflow-test.json';
import animationTestActions from '@/config/actions/animation-test.json';
import popupTestActions from '@/config/actions/popup-test.json';
import dsActionsJson from '@/config/actions/datasource-actions.json';
import type { NamedDataSourceDef } from '@/config/datasource-types';

// ── In-memory variable additions (lost on reload) ─────────────────────────────

let _extraVariables: Array<{ id: string; [k: string]: unknown }> = [];

export function addVariable(id: string, variable: Record<string, unknown>) {
  _extraVariables = [..._extraVariables, { id, ...variable }];
}

// ── Main builder config ───────────────────────────────────────────────────────

export function getBuilderConfig() {
  const dataSources = dataSourcesJson as Record<string, NamedDataSourceDef>;

  const folderNameToId = new Map<string, string>();
  for (const def of Object.values(dataSources)) {
    if (def.folder && !folderNameToId.has(def.folder)) {
      folderNameToId.set(def.folder, `cfg-folder-${def.folder.toLowerCase().replace(/\s+/g, '-')}`);
    }
  }

  const dataSourceList = Object.entries(dataSources).map(([uuid, def]) => {
    const folderId = def.folder ? folderNameToId.get(def.folder) : undefined;
    const base = {
      id: uuid,
      storeIn: uuid,
      _fromConfig: true,
      ...(folderId ? { folderId } : {}),
      ...(def.label ? { _label: def.label } : {}),
    };

    if (def.type === 'graphql') {
      const headersArr = def.headers
        ? Object.entries(def.headers).map(([key, value]) => ({ key, value, enabled: true }))
        : [];
      const opMatch = def.query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/i);
      const operationName = opMatch?.[1] ?? uuid;
      return {
        ...base,
        type: 'graphql' as const,
        url: def.endpoint,
        method: 'POST' as const,
        headers: headersArr,
        responsePath: '',
        proxy: false,
        sendCredentials: false,
        query: def.query,
        variables: def.variables ? JSON.stringify(def.variables, null, 2) : undefined,
        _operationName: operationName,
      };
    }

    const headersArr = Array.isArray(def.headers)
      ? def.headers
      : def.headers
        ? Object.entries(def.headers as Record<string, string>).map(([key, value]) => ({ key, value, enabled: true }))
        : [];

    return {
      ...base,
      type: 'rest' as const,
      url: def.url,
      method: def.method ?? 'GET',
      headers: headersArr,
      queryParams: def.queryParams ?? [],
      responsePath: '',
      proxy: def.proxy ?? false,
      sendCredentials: def.sendCredentials ?? false,
    };
  });

  const dsFolders = Array.from(folderNameToId.entries()).map(([name, id]) => ({
    id,
    name,
    parentId: null as string | null,
  }));

  type VarDef = {
    label?: string;
    type?: string;
    initialValue?: unknown;
    folder?: string;
    fields?: Array<{ name: string; type?: string; initialValue?: unknown; validation?: Record<string, unknown> }>;
  };
  const varsConfig = variablesJson as { variables: Record<string, VarDef>; varFolders: Array<{ id: string; label: string }> };
  const configVariables = Object.entries(varsConfig.variables ?? {}).map(([uuid, def]) => ({
    id: uuid,
    label: def.label ?? uuid,
    type: def.type ?? 'string',
    initialValue: def.initialValue,
    folder: def.folder,
    fields: def.fields,
    _fromConfig: true,
  }));

  const variables = [
    ...configVariables,
    ..._extraVariables.map(v => ({ ...v, _fromConfig: false })),
  ];

  const varFolders = (varsConfig.varFolders ?? []).map(f => ({
    id: f.id,
    label: f.label,
  }));

  const allActions: Record<string, Record<string, unknown>> = {
    ...(authActions as Record<string, Record<string, unknown>>),
    ...(cartActions as Record<string, Record<string, unknown>>),
    ...(checkoutActions as Record<string, Record<string, unknown>>),
    ...(accountActions as Record<string, Record<string, unknown>>),
    ...(productsActions as Record<string, Record<string, unknown>>),
    ...(layoutActions as Record<string, Record<string, unknown>>),
    ...(workflowTestActions as Record<string, Record<string, unknown>>),
    ...(animationTestActions as Record<string, Record<string, unknown>>),
    ...(popupTestActions as Record<string, Record<string, unknown>>),
  };

  const workflows = Object.entries(allActions)
    .filter(([, def]) => def.type === 'workflowSteps')
    .map(([id, def]) => ({
      id,
      name: (def.name as string) ?? id,
      trigger: (def.trigger as string) ?? 'click',
      steps: (def.steps as object[]) ?? [],
      onErrorSteps: (def.onErrorSteps as object[] | undefined),
    }));

  const directActions = Object.fromEntries(
    Object.entries(allActions).filter(([, def]) => def.type && def.type !== 'workflowSteps')
  );

  const dsActionsMap: Record<string, string> = {};
  for (const [actionId, def] of Object.entries(dsActionsJson as Record<string, { name?: string; type?: string }>)) {
    if (def.type === 'refetchDataSource' && def.name) {
      dsActionsMap[def.name] = actionId;
    }
  }

  return { dataSources: dataSourceList, dsFolders, variables, varFolders, workflows, directActions, dsActionsMap };
}

// ── Backend project config load / save ────────────────────────────────────────

/**
 * Load a project's saved config blob from the backend.
 * Returns `null` if the project has no saved config yet (empty `{}`),
 * or if the fetch fails.
 */
export async function loadProjectConfig(projectId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}/config`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json() as { config?: Record<string, unknown> };
    const config = data.config;
    // Treat an empty object as "no saved config yet"
    if (!config || Object.keys(config).length === 0) return null;
    return config;
  } catch {
    return null;
  }
}
