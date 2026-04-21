/**
 * App config - loads root.ts (single entry point for all config)
 * Uses config resolver for $slot and layout composition
 */

import root from './root';
import { resolveScreenConfig, type ConfigRegistry } from '@/lib/sdui/config-resolver';
import formulasJson from './formulas.json';
import { registerGlobalFormulas } from '@/lib/sdui/formula-evaluator';

// Bootstrap global formula registry for runtime formula evaluation
// (builder also calls registerGlobalFormulas via its store subscription)
registerGlobalFormulas(formulasJson as Record<string, unknown>);

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
  dataSources: root.dataSources,
  sharedComponents: root.sharedComponents,
  /** Action to run once on first app mount — used for session restore. */
  startupAction: '9b0c1d2e-f3a4-5678-9abc-def012345678' as string | undefined,
  /** Global authentication configuration passed to SDUIEngine. */
  authConfig: {
    tokenType: 'bearer' as const,
    userQuery: '{ activeCustomer { id emailAddress firstName lastName } }',
    userQueryEndpoint: 'http://localhost:3000/shop-api',
    userQueryHeaders: { 'vendure-token': '__default_channel__' },
    unauthenticatedRedirect: '/sign-in',
    authenticatedRedirect: '/',
    unauthorizedRedirect: '/',
  },
} as const;
