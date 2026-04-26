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
import javascriptTestActions from '@/config/actions/javascript-test.json';
import animationTestActions from '@/config/actions/animation-test.json';
import dsActionsJson from '@/config/actions/datasource-actions.json';
import calculatorActions from '@/config/actions/calculator.json';
import counterExampleActions from '@/config/actions/counter-example.json';
import pricingNestedActions from '@/config/actions/pricing-nested.json';
import responsiveTestActions from '@/config/actions/responsive-test.json';
import sharedComponentTestActions from '@/config/actions/shared-component-test.json';
import popoverTestActions from '@/config/actions/popover-test.json';
import animationShowcaseActions from '@/config/actions/animation-showcase.json';
import triggersTestActions from '@/config/actions/triggers-test.json';
import scComponentShowcaseActions from '@/config/actions/sc-component-showcase.json';
import datepickerTestActions from '@/config/actions/datepicker-test.json';
import sharedComponentsJson from '@/config/shared-components.json';
import formulasJson from '@/config/formulas.json';
import customColorsJson from '@/config/custom-colors.json';
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
        ? Object.entries(def.headers).map(([key, value]) => ({
            key,
            value: typeof value === 'string' ? value : JSON.stringify(value),
            enabled: true,
          }))
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
        ? Object.entries(def.headers as Record<string, unknown>).map(([key, value]) => ({
            key,
            value: typeof value === 'string' ? value : JSON.stringify(value),
            enabled: true,
          }))
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
    saveInLocalStorage?: boolean;
    fields?: Array<{ name: string; type?: string; initialValue?: unknown; validation?: Record<string, unknown> }>;
  };
  const varsConfig = variablesJson as { variables: Record<string, VarDef>; varFolders: Array<{ id: string; label: string }> };
  const configVariables = Object.entries(varsConfig.variables ?? {}).map(([uuid, def]) => ({
    id: uuid,
    label: def.label ?? uuid,
    type: def.type ?? 'string',
    initialValue: def.initialValue,
    folder: def.folder,
    saveInLocalStorage: def.saveInLocalStorage,
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
    ...(javascriptTestActions as Record<string, Record<string, unknown>>),
    ...(animationTestActions as Record<string, Record<string, unknown>>),
    ...(calculatorActions as Record<string, Record<string, unknown>>),
    ...(counterExampleActions as Record<string, Record<string, unknown>>),
    ...(pricingNestedActions as Record<string, Record<string, unknown>>),
    ...(responsiveTestActions as Record<string, Record<string, unknown>>),
    ...(sharedComponentTestActions as Record<string, Record<string, unknown>>),
    ...(popoverTestActions as Record<string, Record<string, unknown>>),
    ...(animationShowcaseActions as Record<string, Record<string, unknown>>),
    ...(triggersTestActions as Record<string, Record<string, unknown>>),
    ...(scComponentShowcaseActions as Record<string, Record<string, unknown>>),
    ...(datepickerTestActions as Record<string, Record<string, unknown>>),
  };

  // A workflow def has a steps array. A direct action has a specific type (graphql, fetch, etc.)
  const workflows = Object.entries(allActions)
    .filter(([, def]) => Array.isArray(def.steps))
    .map(([id, def]) => ({
      id,
      name: (def.name as string) ?? id,
      trigger: (def.trigger as string) ?? 'click',
      steps: (def.steps as object[]) ?? [],
      onErrorSteps: (def.onErrorSteps as object[] | undefined),
      isTrigger: (def.isTrigger as boolean | undefined),
      pageScope: (def.pageScope as string | undefined),
      // Pass through params so global workflows (those with params) are detected by the store
      params: (def.params as Array<{ id: string; name: string; type: string; allowMultiple?: boolean; testValue?: unknown }> | undefined),
    }));

  // ── Register shared component workflows so executeComponentAction's picker can find them.
  // These are NOT page-scoped actions, but they need to appear in pageWorkflowMeta so the
  // builder UI can display a human-readable name when a config.action references them.
  const scModels = sharedComponentsJson as Record<string, {
    name?: string;
    workflows?: Record<string, { trigger: string; steps: unknown[]; name?: string }>;
  }>;
  for (const [scId, scModel] of Object.entries(scModels)) {
    const scName = scModel.name ?? scId;
    for (const [wfId, wf] of Object.entries(scModel.workflows ?? {})) {
      if (workflows.some(w => w.id === wfId)) continue;
      workflows.push({
        id: wfId,
        name: `${scName} — ${wf.name ?? wfId}`,
        trigger: wf.trigger ?? 'execution',
        steps: (wf.steps as object[]) ?? [],
        onErrorSteps: undefined,
        isTrigger: undefined,
        pageScope: undefined,
        params: undefined,
      });
    }
  }

  const directActions = Object.fromEntries(
    Object.entries(allActions).filter(([, def]) => def.type && !Array.isArray(def.steps))
  );

  const dsActionsMap: Record<string, string> = {};
  for (const [actionId, def] of Object.entries(dsActionsJson as Record<string, { name?: string; type?: string }>)) {
    if (def.type === 'refetchDataSource' && def.name) {
      dsActionsMap[def.name] = actionId;
    }
  }

  const formulas = formulasJson as Record<string, import('@/app/dev/builder/_store-types').GlobalFormulaDef>;

  const customColors = (customColorsJson as { customColors?: unknown[]; colorFolders?: unknown[] }).customColors ?? [];
  const colorFolders = (customColorsJson as { customColors?: unknown[]; colorFolders?: unknown[] }).colorFolders ?? [];

  return { dataSources: dataSourceList, dsFolders, variables, varFolders, workflows, directActions, dsActionsMap, formulas, customColors, colorFolders };
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
