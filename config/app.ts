/**
 * App config - loads root.ts (single entry point for all config)
 * Uses config resolver for $ref, $slot, and layout composition
 */

import root from './root';
import { resolveScreenConfig, type ConfigRegistry } from '@/lib/sdui/config-resolver';

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
} as const;
