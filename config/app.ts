/**
 * App config - loads root.ts (single entry point for all config)
 * Uses config resolver for $slot and layout composition
 */

import root from './root';
import { resolveScreenConfig, type ConfigRegistry } from '@/lib/sdui/config-resolver';
import formulasJson from './formulas.json';
import variablesJson from './variables.json';
import dataSourcesJson from './datasources.json';
import { registerGlobalFormulas } from '@/lib/sdui/formula-evaluator';
import { registerVariableNames, registerCollectionNames } from '@/lib/sdui/variable-name-registry';

// Bootstrap global formula registry for runtime formula evaluation
// (builder also calls registerGlobalFormulas via its store subscription)
registerGlobalFormulas(formulasJson as Record<string, unknown>);

// Bootstrap variable / collection name registries so JavaScript bindings
// ({ "js": "variables.cartCount" }) and the runJavaScript workflow action
// can resolve names → UUIDs at runtime.
{
  const vars = (variablesJson as { variables?: Record<string, { label?: string }> })?.variables ?? {};
  const varMap: Record<string, string> = {};
  for (const [uuid, def] of Object.entries(vars)) {
    const label = def?.label ?? uuid;
    if (label) varMap[label] = uuid;
  }
  registerVariableNames(varMap);

  const ds = dataSourcesJson as Record<string, { label?: string; name?: string }>;
  const colMap: Record<string, string> = {};
  for (const [uuid, def] of Object.entries(ds)) {
    const label = def?.label ?? def?.name ?? uuid;
    if (label) colMap[label] = uuid;
  }
  registerCollectionNames(colMap);
}

const registry: ConfigRegistry = {
  layouts: root.layouts as ConfigRegistry['layouts'],
  fragments: root.fragments as ConfigRegistry['fragments'],
};

const rawScreens = root.screens as Record<string, Record<string, unknown>>;

const screens = Object.fromEntries(
  Object.entries(rawScreens).map(([name, screen]) => [
    name,
    resolveScreenConfig(screen as Parameters<typeof resolveScreenConfig>[0], registry),
  ])
) as unknown as Record<string, { meta?: object; state?: object; ui: object }>;

export default {
  ...root.routes,
  screens,
  rawScreens,
  registry,
  actions: root.actions,
  /** Unified named-workflow dictionary for runtime executeWorkflow step resolution. */
  workflows: root.workflows,
  dataSources: root.dataSources,
  sharedComponents: root.sharedComponents,
  /** Action to run once on first app mount — used for session restore. */
  startupAction: '9b0c1d2e-f3a4-5678-9abc-def012345678' as string | undefined,
  /** Global authentication configuration passed to SDUIEngine. */
  authConfig: {
    tokenType: 'bearer' as const,
    userEndpoint: 'http://localhost:4000/v1/run/cmpfgh9d20003ti913oelf5bs/auth/me',
    unauthenticatedRedirect: '/sign-in',
    authenticatedRedirect: '/',
    unauthorizedRedirect: '/',
  },
} as const;
