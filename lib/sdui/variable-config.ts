/**
 * Reads variable-level flags from variables.json:
 *   persist, resetOnNavigate, role, initialValue
 * These replace the old engineConventions fields:
 *   persistPaths, resetVarsOnNavigate, themePath, sortInputMap, defaultSortInput
 */

import variablesJson from '@/config/variables.json';

type VariableDef = {
  initialValue?: unknown;
  persist?: string;
  resetOnNavigate?: boolean;
  role?: string;
};

type VariablesJson = {
  variables: Record<string, VariableDef>;
};

const { variables } = variablesJson as VariablesJson;

/** Variable UUIDs that should be persisted to sessionStorage (persist: "session") */
export const PERSIST_PATHS: string[] = Object.entries(variables)
  .filter(([, v]) => v.persist === 'session')
  .map(([uuid]) => uuid);

/** Variable UUIDs that should be reset to false on navigation */
export const RESET_ON_NAVIGATE_PATHS: string[] = Object.entries(variables)
  .filter(([, v]) => v.resetOnNavigate === true)
  .map(([uuid]) => uuid);

/** UUID of the Color Scheme variable (role: "theme") */
export const THEME_PATH: string =
  Object.entries(variables).find(([, v]) => v.role === 'theme')?.[0] ?? 'nav.colorScheme';
