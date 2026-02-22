/**
 * Engine conventions - loaded from store.json engineConventions
 */

import storeConfig from '@/config/store-config';

type EngineConventions = {
  computedConventionKeys?: string[];
  themePath?: string;
  defaultPaginationPath?: string;
  defaultPaginationFetchAction?: string;
  shareSlugPrefix?: string;
  loadingSuffix?: string;
  errorSuffix?: string;
  defaultStoreErrorsIn?: string;
  defaultStoreIn?: string;
  defaultErrorMessagePath?: string;
  workflowPath?: string;
  screenScopedAliases?: string[];
  persistPaths?: string[];
  sortInputMap?: Record<string, Record<string, string>>;
  defaultSortInput?: Record<string, string>;
  graphqlEndpoint?: string;
  graphqlHeaders?: Record<string, string>;
  graphqlCredentials?: RequestCredentials;
};

const engineConventions = (storeConfig as { engineConventions?: EngineConventions }).engineConventions ?? {};

export const CONVENTIONS = {
  computedConventionKeys: engineConventions.computedConventionKeys ?? ['sortInputMap', 'defaultSortInput'],
  themePath: engineConventions.themePath ?? 'nav.colorScheme',
  defaultPaginationPath: engineConventions.defaultPaginationPath ?? 'collectionSkip',
  defaultPaginationFetchAction: engineConventions.defaultPaginationFetchAction ?? 'fetchCollection',
  shareSlugPrefix: engineConventions.shareSlugPrefix ?? '/product',
  loadingSuffix: engineConventions.loadingSuffix,
  errorSuffix: engineConventions.errorSuffix,
  defaultStoreErrorsIn: engineConventions.defaultStoreErrorsIn,
  defaultStoreIn: engineConventions.defaultStoreIn,
  defaultErrorMessagePath: engineConventions.defaultErrorMessagePath,
  workflowPath: engineConventions.workflowPath,
  screenScopedAliases: engineConventions.screenScopedAliases ?? [],
  persistPaths: engineConventions.persistPaths ?? [],
  sortInputMap: engineConventions.sortInputMap ?? {},
  defaultSortInput: engineConventions.defaultSortInput ?? { name: 'ASC' },
  graphqlEndpoint: engineConventions.graphqlEndpoint,
  graphqlHeaders: engineConventions.graphqlHeaders ?? {},
  graphqlCredentials: engineConventions.graphqlCredentials,
};

/** Build _conventions from config for computed values (config-driven via engineConventions.computedConventionKeys). */
export function buildConventionsForComputed(): Record<string, unknown> {
  const keys = CONVENTIONS.computedConventionKeys;
  const out: Record<string, unknown> = {};
  const conv = CONVENTIONS as Record<string, unknown>;
  for (const k of keys) {
    const v = conv[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
